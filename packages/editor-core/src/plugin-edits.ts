// The project's plugins in the editor (M15 step 5): add a plugin folder
// (copied into plugins/<id>/), turn plugins on and off, order them, change
// their settings, and remove them. The list lives in project.json and each
// declaration is a document file, so all of it is undoable; a plugin's other
// files (its script, pictures) are written at once when it's added and
// deleted by the save that removes its plugin.json (`settlePluginFolders`).
import {
  type Manifest,
  type PluginDeclaration,
  type PluginValue,
  type PluginValues,
  ProjectFileError,
  checkPluginShape,
  parseProjectFile,
  pluginPath,
} from '@freequest/schema';
import type { ProjectDocument } from './document.js';
import type { ProjectFs } from './project-fs.js';
import { MANIFEST_PATH } from './open-project.js';
import { normalizeProjectPath } from './paths.js';
import { decodeUtf8 } from './utf8.js';

/** One file of a plugin folder being added, relative to the folder. */
export interface PluginSourceFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** A plugin folder can't hold more than this (a plugin is code and a few pictures or sounds). */
export const MAX_PLUGIN_FILES = 500;
export const MAX_PLUGIN_BYTES = 50 * 1024 * 1024;

export class PluginAddError extends Error {
  override name = 'PluginAddError';
}

/** Hidden and system files a copied folder shouldn't bring along (.DS_Store, .git…). */
const skipped = (path: string) => path.split('/').some((part) => part.startsWith('.'));

/**
 * Read a plugin folder's files: its declaration (checked, readable reasons
 * when it isn't one) and the files to copy. Paths are relative to the folder.
 */
export function readPluginFolder(files: readonly PluginSourceFile[]): {
  readonly declaration: PluginDeclaration;
  readonly files: readonly PluginSourceFile[];
} {
  const kept = files.filter((f) => !skipped(f.path));
  const manifest = kept.find((f) => f.path === 'plugin.json');
  if (!manifest) {
    throw new PluginAddError('This folder has no plugin.json, so it isn’t a FreeQuest plugin.');
  }
  if (kept.length > MAX_PLUGIN_FILES) {
    throw new PluginAddError(`A plugin can have at most ${MAX_PLUGIN_FILES} files.`);
  }
  const size = kept.reduce((sum, f) => sum + f.bytes.byteLength, 0);
  if (size > MAX_PLUGIN_BYTES) {
    throw new PluginAddError(
      `This folder holds ${Math.round(size / 1024 / 1024)} MB; a plugin can be at most ${MAX_PLUGIN_BYTES / 1024 / 1024} MB.`,
    );
  }
  for (const f of kept) {
    try {
      normalizeProjectPath(f.path);
    } catch (error) {
      throw new PluginAddError((error as Error).message);
    }
  }
  let declaration: PluginDeclaration;
  try {
    declaration = parseProjectFile('plugin', JSON.parse(decodeUtf8(manifest.bytes)) as unknown);
  } catch (error) {
    const reason =
      error instanceof ProjectFileError
        ? error.message
        : `it isn’t valid JSON (${(error as Error).message})`;
    throw new PluginAddError(`plugin.json can’t be read: ${reason}`);
  }
  const problems = checkPluginShape(declaration);
  if (problems.length > 0) {
    throw new PluginAddError(`plugin.json has problems: ${problems.join('; ')}`);
  }
  if (!kept.some((f) => f.path === declaration.entry)) {
    throw new PluginAddError(
      `plugin.json names the script ${declaration.entry}, which isn’t there.`,
    );
  }
  return { declaration, files: kept };
}

/** Every file of a folder as plugin source files (the editor reads a picked folder through a ProjectFs). */
export async function pluginSourceFiles(fs: ProjectFs): Promise<PluginSourceFile[]> {
  const paths = (await fs.list('')).filter((p) => !skipped(p));
  if (paths.length > MAX_PLUGIN_FILES) {
    throw new PluginAddError(`A plugin can have at most ${MAX_PLUGIN_FILES} files.`);
  }
  return Promise.all(paths.map(async (path) => ({ path, bytes: await fs.readBytes(path) })));
}

const pluginRefs = (m: Manifest) => m.plugins ?? [];

/**
 * Add a plugin folder to the project: its files are written into
 * plugins/<id>/ at once, its declaration and the manifest's listing (turned
 * on, last) are one undo step. Refuses an id the project already lists.
 */
export async function addPlugin(
  doc: ProjectDocument,
  files: readonly PluginSourceFile[],
): Promise<PluginDeclaration> {
  const { declaration, files: kept } = readPluginFolder(files);
  const { id } = declaration;
  if (pluginRefs(doc.project.manifest.data).some((ref) => ref.id === id)) {
    throw new PluginAddError(
      `The project already has a plugin with the id “${id}”. Remove it first to replace it.`,
    );
  }
  const path = pluginPath(id);
  const folder = path.slice(0, -'plugin.json'.length);
  for (const file of kept) {
    if (file.path !== 'plugin.json') await doc.fs.writeBytes(folder + file.path, file.bytes);
  }
  doc.edit(`Add plugin ${declaration.name}`, (tx) => {
    if (tx.file(path)) tx.update(path, 'plugin', () => declaration);
    else tx.create(path, 'plugin', id, declaration);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      plugins: [...pluginRefs(m), { id, path, enabled: true }],
    }));
  });
  return declaration;
}

function changeRef(
  m: Manifest,
  id: string,
  change: (
    ref: NonNullable<Manifest['plugins']>[number],
  ) => NonNullable<Manifest['plugins']>[number],
): Manifest {
  const refs = pluginRefs(m);
  if (!refs.some((r) => r.id === id)) return m;
  return { ...m, plugins: refs.map((r) => (r.id === id ? change(r) : r)) };
}

export function setPluginEnabled(m: Manifest, id: string, enabled: boolean): Manifest {
  return changeRef(m, id, (r) => (r.enabled === enabled ? r : { ...r, enabled }));
}

/** Move a plugin earlier (-1) or later (+1): plugins start in this order. */
export function movePlugin(m: Manifest, id: string, delta: number): Manifest {
  const refs = [...pluginRefs(m)];
  const from = refs.findIndex((r) => r.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= refs.length) return m;
  const [moved] = refs.splice(from, 1);
  if (!moved) return m;
  refs.splice(to, 0, moved);
  return { ...m, plugins: refs };
}

/** Set one setting's value; `undefined` goes back to the declared default. */
export function setPluginSetting(
  m: Manifest,
  id: string,
  name: string,
  value: PluginValue | undefined,
): Manifest {
  return changeRef(m, id, (r) => {
    const { [name]: _old, ...rest } = r.settings ?? {};
    const settings: PluginValues = value === undefined ? rest : { ...rest, [name]: value };
    const { settings: _settings, ...bare } = r;
    return Object.keys(settings).length > 0 ? { ...bare, settings } : bare;
  });
}

/**
 * Take a plugin out of the project (one undo step): its listing and its
 * declaration go now; the save that deletes plugin.json deletes the rest of
 * its folder. Commands that use it show a problem until they change.
 */
export function removePlugin(doc: ProjectDocument, id: string): void {
  const ref = pluginRefs(doc.project.manifest.data).find((r) => r.id === id);
  if (!ref) return;
  const name = doc.project.plugins.get(id)?.data?.name ?? id;
  doc.edit(`Remove plugin ${name}`, (tx) => {
    if (tx.file(ref.path)) tx.remove(ref.path);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      plugins: pluginRefs(m).filter((r) => r.id !== id),
    }));
  });
}

/**
 * After a save that deleted these paths: for each plugins/<id>/plugin.json
 * among them whose plugin the project no longer lists, delete the rest of
 * that folder. Returns the deleted files.
 */
export async function settlePluginFolders(
  fs: ProjectFs,
  manifest: Manifest,
  removed: readonly string[],
): Promise<string[]> {
  const listed = new Set(pluginRefs(manifest).map((r) => r.id));
  const deleted: string[] = [];
  for (const path of removed) {
    const match = /^plugins\/([^/]+)\/plugin\.json$/.exec(path);
    const id = match?.[1];
    if (!id || listed.has(id)) continue;
    for (const file of await fs.list(`plugins/${id}`)) {
      await fs.remove(file);
      deleted.push(file);
    }
  }
  return deleted;
}
