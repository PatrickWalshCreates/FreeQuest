import {
  type CharacterSheet,
  DATABASE_KINDS,
  type Database,
  type DatabaseFiles,
  type FileKind,
  type FileData,
  type FileRef,
  type GameMap,
  type Manifest,
  ProjectFileError,
  type Tileset,
  assembleDatabase,
  checkDatabase,
  checkManifestReferences,
  checkMapReferences,
  checkMapShape,
  parseProjectFile,
} from '@freequest/schema';

/**
 * Where a project's files come from: a folder served over HTTP
 * (`httpSource`), or anything else that can hand over parsed JSON and asset
 * URLs, such as the editor's unsaved document when playtesting.
 */
export interface ProjectSource {
  /** Parse a project-relative JSON file. Rejects with an Error naming the problem. */
  readJson(path: string): Promise<unknown>;
  /** A URL an image or audio loader can fetch for a project-relative asset path. */
  assetUrl(path: string): Promise<string>;
}

/** A project folder served over HTTP. `projectUrl` points at the folder containing project.json. */
export function httpSource(projectUrl: string | URL): ProjectSource {
  const baseUrl = new URL(projectUrl);
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';
  return {
    async readJson(path) {
      const response = await fetch(new URL(path, baseUrl));
      if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
      try {
        return (await response.json()) as unknown;
      } catch (e) {
        throw new ProjectFileError(path, [`invalid JSON: ${(e as Error).message}`]);
      }
    },
    assetUrl: (path) => Promise.resolve(new URL(path, baseUrl).href),
  };
}

/**
 * A project with its manifest, tilesets and character sheets fetched,
 * migrated and validated. Maps load on demand through `loadMap`, so large
 * projects don't fetch every map up front. Images are not loaded here.
 */
export interface LoadedProject {
  readonly manifest: Manifest;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly characters: ReadonlyMap<string, CharacterSheet>;
  /** Every database category (missing files are empty). Loaded up front. */
  readonly database: Database;
  /** Maps fetched so far. */
  readonly maps: ReadonlyMap<string, GameMap>;
  /** Fetch and validate a map (once; later calls reuse it). */
  loadMap(id: string): Promise<GameMap>;
  /** A URL for a project-relative asset (images, audio). */
  assetUrl(path: string): Promise<string>;
}

async function fetchFile<K extends FileKind>(
  source: ProjectSource,
  kind: K,
  path: string,
): Promise<FileData<K>> {
  return parseProjectFile(kind, await source.readJson(path), path);
}

async function fetchAll<K extends 'tileset' | 'map' | 'character'>(
  source: ProjectSource,
  kind: K,
  refs: FileRef[],
): Promise<Map<string, FileData<K>>> {
  const entries = await Promise.all(
    refs.map(async (ref) => {
      const data = await fetchFile(source, kind, ref.path);
      if (data.id !== ref.id) {
        throw new ProjectFileError(ref.path, [
          `id "${data.id}" does not match manifest id "${ref.id}"`,
        ]);
      }
      return [ref.id, data] as const;
    }),
  );
  return new Map(entries);
}

async function fetchDatabase(source: ProjectSource, manifest: Manifest): Promise<Database> {
  const entries = await Promise.all(
    DATABASE_KINDS.map(async (kind) => {
      const path = manifest.database?.[kind];
      return path ? [[kind, await fetchFile(source, kind, path)] as const] : [];
    }),
  );
  return assembleDatabase(Object.fromEntries(entries.flat()) as DatabaseFiles);
}

/**
 * Load a project: from a URL (the folder containing project.json, served
 * over HTTP) or from any `ProjectSource`.
 */
export async function loadProject(from: string | URL | ProjectSource): Promise<LoadedProject> {
  const source = typeof from === 'string' || from instanceof URL ? httpSource(from) : from;

  const manifest = await fetchFile(source, 'manifest', 'project.json');
  const [tilesets, characters, database] = await Promise.all([
    fetchAll(source, 'tileset', manifest.tilesets),
    fetchAll(source, 'character', manifest.characters),
    fetchDatabase(source, manifest),
  ]);
  const databaseProblems = checkDatabase(database, { manifest, characters });
  if (databaseProblems.length > 0) throw new ProjectFileError('database', databaseProblems);
  const maps = new Map<string, GameMap>();
  const pending = new Map<string, Promise<GameMap>>();
  const context = { manifest, tilesets, characters, maps, database };

  const loadMap = (id: string): Promise<GameMap> => {
    let promise = pending.get(id);
    if (!promise) {
      const ref = manifest.maps.find((m) => m.id === id);
      if (!ref) return Promise.reject(new Error(`map "${id}" is not listed in project.json`));
      promise = (async () => {
        const map = await fetchFile(source, 'map', ref.path);
        if (map.id !== ref.id) {
          throw new ProjectFileError(ref.path, [
            `id "${map.id}" does not match manifest id "${ref.id}"`,
          ]);
        }
        maps.set(id, map);
        const problems = [...checkMapShape(map), ...checkMapReferences(map, context)];
        if (problems.length > 0) {
          maps.delete(id);
          throw new ProjectFileError(ref.path, problems);
        }
        return map;
      })();
      // Forget failures so a later attempt can retry (e.g. after fixing the file).
      promise.catch(() => pending.delete(id));
      pending.set(id, promise);
    }
    return promise;
  };

  const problems = checkManifestReferences(context);
  if (problems.length > 0) throw new ProjectFileError('project.json', problems);
  // The start map is needed immediately; loading it here also bounds-checks the start position.
  await loadMap(manifest.start.map);
  const startProblems = checkManifestReferences(context);
  if (startProblems.length > 0) throw new ProjectFileError('project.json', startProblems);

  return {
    manifest,
    tilesets,
    characters,
    database,
    maps,
    loadMap,
    assetUrl: (path) => source.assetUrl(path),
  };
}

/** Look up a loaded file by id, throwing a readable error if it is missing. */
export function getOrThrow<T>(files: ReadonlyMap<string, T>, id: string, kind: string): T {
  const file = files.get(id);
  if (file === undefined) throw new Error(`${kind} "${id}" is not part of this project`);
  return file;
}
