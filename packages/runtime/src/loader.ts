import {
  type CharacterSheet,
  type FileKind,
  type FileData,
  type FileRef,
  type GameMap,
  type Manifest,
  ProjectFileError,
  type Tileset,
  checkManifestReferences,
  checkMapReferences,
  checkMapShape,
  parseProjectFile,
} from '@freequest/schema';

/**
 * A project with its manifest, tilesets and character sheets fetched,
 * migrated and validated. Maps load on demand through `loadMap`, so large
 * projects don't fetch every map up front. Images are not loaded here.
 */
export interface LoadedProject {
  /** URL of the project folder (ends with "/"). */
  readonly baseUrl: URL;
  readonly manifest: Manifest;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly characters: ReadonlyMap<string, CharacterSheet>;
  /** Maps fetched so far. */
  readonly maps: ReadonlyMap<string, GameMap>;
  /** Fetch and validate a map (once; later calls reuse it). */
  loadMap(id: string): Promise<GameMap>;
  /** Resolve a project-relative path to an absolute URL. */
  resolve(path: string): string;
}

async function fetchFile<K extends FileKind>(
  baseUrl: URL,
  kind: K,
  path: string,
): Promise<FileData<K>> {
  const url = new URL(path, baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch (e) {
    throw new ProjectFileError(path, [`invalid JSON: ${(e as Error).message}`]);
  }
  return parseProjectFile(kind, json, path);
}

async function fetchAll<K extends 'tileset' | 'map' | 'character'>(
  baseUrl: URL,
  kind: K,
  refs: FileRef[],
): Promise<Map<string, FileData<K>>> {
  const entries = await Promise.all(
    refs.map(async (ref) => {
      const data = await fetchFile(baseUrl, kind, ref.path);
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

/** Load a project folder served over HTTP. `projectUrl` points at the folder containing project.json. */
export async function loadProject(projectUrl: string | URL): Promise<LoadedProject> {
  const baseUrl = new URL(projectUrl);
  if (!baseUrl.pathname.endsWith('/')) baseUrl.pathname += '/';

  const manifest = await fetchFile(baseUrl, 'manifest', 'project.json');
  const [tilesets, characters] = await Promise.all([
    fetchAll(baseUrl, 'tileset', manifest.tilesets),
    fetchAll(baseUrl, 'character', manifest.characters),
  ]);
  const maps = new Map<string, GameMap>();
  const pending = new Map<string, Promise<GameMap>>();
  const context = { manifest, tilesets, characters, maps };

  const loadMap = (id: string): Promise<GameMap> => {
    let promise = pending.get(id);
    if (!promise) {
      const ref = manifest.maps.find((m) => m.id === id);
      if (!ref) return Promise.reject(new Error(`map "${id}" is not listed in project.json`));
      promise = (async () => {
        const map = await fetchFile(baseUrl, 'map', ref.path);
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
    baseUrl,
    manifest,
    tilesets,
    characters,
    maps,
    loadMap,
    resolve: (path) => new URL(path, baseUrl).href,
  };
}

/** Look up a loaded file by id, throwing a readable error if it is missing. */
export function getOrThrow<T>(files: ReadonlyMap<string, T>, id: string, kind: string): T {
  const file = files.get(id);
  if (file === undefined) throw new Error(`${kind} "${id}" is not part of this project`);
  return file;
}
