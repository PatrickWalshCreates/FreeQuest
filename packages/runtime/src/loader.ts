import {
  type CharacterSheet,
  type FileKind,
  type FileData,
  type FileRef,
  type GameMap,
  type Manifest,
  ProjectFileError,
  type ProjectData,
  type Tileset,
  checkMapShape,
  checkReferences,
  parseProjectFile,
} from '@freequest/schema';

/** A project with all data files fetched, migrated and validated. Images are not loaded yet. */
export interface LoadedProject extends ProjectData {
  /** URL of the project folder (ends with "/"). */
  readonly baseUrl: URL;
  readonly manifest: Manifest;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly maps: ReadonlyMap<string, GameMap>;
  readonly characters: ReadonlyMap<string, CharacterSheet>;
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
  const [tilesets, maps, characters] = await Promise.all([
    fetchAll(baseUrl, 'tileset', manifest.tilesets),
    fetchAll(baseUrl, 'map', manifest.maps),
    fetchAll(baseUrl, 'character', manifest.characters),
  ]);

  for (const ref of manifest.maps) {
    const problems = checkMapShape(getOrThrow(maps, ref.id, 'map'));
    if (problems.length > 0) throw new ProjectFileError(ref.path, problems);
  }
  const problems = checkReferences({ manifest, tilesets, maps, characters });
  if (problems.length > 0) throw new ProjectFileError('project', problems);

  return {
    baseUrl,
    manifest,
    tilesets,
    maps,
    characters,
    resolve: (path) => new URL(path, baseUrl).href,
  };
}

/** Look up a loaded file by id, throwing a readable error if it is missing. */
export function getOrThrow<T>(files: ReadonlyMap<string, T>, id: string, kind: string): T {
  const file = files.get(id);
  if (file === undefined) throw new Error(`${kind} "${id}" is not part of this project`);
  return file;
}
