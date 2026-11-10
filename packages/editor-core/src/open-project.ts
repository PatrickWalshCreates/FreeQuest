import {
  CURRENT_FORMAT_VERSION,
  DATABASE_KINDS,
  type DatabaseFiles,
  type DatabaseKind,
  type FileData,
  type FileKind,
  type FileRef,
  FormatVersionError,
  ProjectFileError,
  assembleDatabase,
  checkDatabase,
  checkMapShape,
  checkReferences,
  parseProjectFile,
} from '@freequest/schema';
import { FileNotFoundError, type ProjectFs } from './project-fs.js';

/** Every kind of file a project folder holds (saves live elsewhere). */
export type DataFileKind = Exclude<FileKind, 'save'>;

export const MANIFEST_PATH = 'project.json';

/** One file of an open project. */
export interface ProjectFile<K extends DataFileKind = DataFileKind> {
  readonly kind: K;
  readonly path: string;
  /** The manifest id (maps, tilesets, characters), the category (database files) or "project". */
  readonly id: string;
  /** Migrated and validated contents; null when the file could not be loaded at all. */
  readonly data: FileData<K> | null;
  /** The file is in an older format: saving it will upgrade it. */
  readonly migrated: boolean;
  /** What is wrong with this file on its own (empty when it is fine). */
  readonly problems: readonly string[];
}

export interface Problem {
  /** A file path, or "references" / "database" for checks across files. */
  readonly source: string;
  readonly message: string;
}

/**
 * A project read into memory for editing. Unlike the runtime loader, this
 * reads every map and keeps going past broken files, so the editor can open
 * a damaged project and show what is wrong. Only an unreadable
 * `project.json` stops it.
 */
export interface OpenedProject {
  readonly fs: ProjectFs;
  readonly manifest: ProjectFile<'manifest'> & { readonly data: FileData<'manifest'> };
  readonly tilesets: ReadonlyMap<string, ProjectFile<'tileset'>>;
  readonly maps: ReadonlyMap<string, ProjectFile<'map'>>;
  readonly characters: ReadonlyMap<string, ProjectFile<'character'>>;
  readonly database: { readonly [K in DatabaseKind]?: ProjectFile<K> };
  /** Every problem: each file's own, then cross-file checks. */
  readonly problems: readonly Problem[];
}

export class ProjectOpenError extends Error {
  override name = 'ProjectOpenError';
}

async function readFile<K extends DataFileKind>(
  fs: ProjectFs,
  kind: K,
  path: string,
  id: string,
): Promise<ProjectFile<K>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readText(path));
  } catch (error) {
    const message =
      error instanceof FileNotFoundError
        ? 'file not found'
        : error instanceof SyntaxError
          ? `invalid JSON: ${error.message}`
          : `could not be read: ${error instanceof Error ? error.message : String(error)}`;
    return { kind, path, id, data: null, migrated: false, problems: [message] };
  }
  const version = (raw as { formatVersion?: unknown } | null)?.formatVersion;
  const migrated = typeof version === 'number' && version < CURRENT_FORMAT_VERSION[kind];
  let data: FileData<K>;
  try {
    data = parseProjectFile(kind, raw, path);
  } catch (error) {
    const problems =
      error instanceof ProjectFileError
        ? error.problems
        : [error instanceof FormatVersionError ? error.message : String(error)];
    return { kind, path, id, data: null, migrated, problems };
  }
  const problems: string[] = [];
  const dataId = (data as { id?: unknown }).id;
  if (typeof dataId === 'string' && dataId !== id) {
    problems.push(`id "${dataId}" does not match the id "${id}" in ${MANIFEST_PATH}`);
  }
  if (kind === 'map') problems.push(...checkMapShape(data as FileData<'map'>));
  return { kind, path, id, data, migrated, problems };
}

function readAll<K extends 'tileset' | 'map' | 'character'>(
  fs: ProjectFs,
  kind: K,
  refs: readonly FileRef[],
): Promise<Map<string, ProjectFile<K>>> {
  return Promise.all(refs.map((ref) => readFile(fs, kind, ref.path, ref.id))).then(
    (files) => new Map(files.map((file) => [file.id, file])),
  );
}

/** Read and check a whole project folder. */
export async function openProject(fs: ProjectFs): Promise<OpenedProject> {
  const manifest = await readFile(fs, 'manifest', MANIFEST_PATH, 'project');
  if (!manifest.data) {
    throw new ProjectOpenError(
      `${fs.label} is not a FreeQuest project: ${MANIFEST_PATH} ${manifest.problems.join('; ')}`,
    );
  }
  const m = manifest.data;
  const manifestFile = { ...manifest, data: m };
  const [tilesets, maps, characters, databaseFiles] = await Promise.all([
    readAll(fs, 'tileset', m.tilesets),
    readAll(fs, 'map', m.maps),
    readAll(fs, 'character', m.characters),
    Promise.all(
      DATABASE_KINDS.flatMap((kind) => {
        const path = m.database?.[kind];
        return path ? [readFile(fs, kind, path, kind)] : [];
      }),
    ),
  ]);
  const database = Object.fromEntries(databaseFiles.map((f) => [f.kind, f])) as {
    [K in DatabaseKind]?: ProjectFile<K>;
  };

  const files = allFiles({ manifest: manifestFile, tilesets, maps, characters, database });
  const problems: Problem[] = files.flatMap((file) =>
    file.problems.map((message) => ({ source: file.path, message })),
  );

  // Cross-file checks only make sense once every file has loaded; otherwise
  // they would repeat each missing file as a dangling reference.
  if (files.every((file) => file.data !== null)) {
    const loaded = <K extends DataFileKind>(source: ReadonlyMap<string, ProjectFile<K>>) =>
      new Map([...source].map(([id, file]) => [id, file.data as FileData<K>]));
    const db = assembleDatabase(
      Object.fromEntries(databaseFiles.map((f) => [f.kind, f.data])) as DatabaseFiles,
    );
    const project = {
      manifest: m,
      tilesets: loaded(tilesets),
      maps: loaded(maps),
      characters: loaded(characters),
      database: db,
    };
    for (const message of checkReferences(project))
      problems.push({ source: 'references', message });
    for (const message of checkDatabase(db, project))
      problems.push({ source: 'database', message });
  }

  return {
    fs,
    manifest: manifestFile,
    tilesets,
    maps,
    characters,
    database,
    problems,
  };
}

/** Every file of a project: manifest, tilesets, maps, characters, then database files. */
export function allFiles(
  project: Pick<OpenedProject, 'manifest' | 'tilesets' | 'maps' | 'characters' | 'database'>,
): ProjectFile[] {
  return [
    project.manifest,
    ...project.tilesets.values(),
    ...project.maps.values(),
    ...project.characters.values(),
    ...DATABASE_KINDS.flatMap((kind) => {
      const file = project.database[kind];
      return file ? [file as ProjectFile] : [];
    }),
  ];
}
