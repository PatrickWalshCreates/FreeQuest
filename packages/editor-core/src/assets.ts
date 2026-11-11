// The project's image and sound files under assets/: listing them with where
// each one is used, importing new ones (copied into the project, checked by
// their contents), and deleting unused ones. Files on disk aren't part of
// the document's undo history: an import or a delete happens at once.
import { type AssetKind, assetReferences } from './export.js';
import type { OpenedProject } from './open-project.js';
import { normalizeProjectPath } from './paths.js';
import type { ProjectFs } from './project-fs.js';

export const ASSETS_DIR = 'assets';

/** The folders the editor offers for imports, in display order. */
export const ASSET_FOLDERS: readonly {
  readonly path: string;
  readonly label: string;
  readonly type: AssetKind;
}[] = [
  { path: 'assets/tilesets', label: 'Tilesets', type: 'image' },
  { path: 'assets/characters', label: 'Characters', type: 'image' },
  { path: 'assets/enemies', label: 'Enemies', type: 'image' },
  { path: 'assets/images', label: 'Other images', type: 'image' },
  { path: 'assets/audio', label: 'Audio', type: 'audio' },
];

/** File formats the game can load, by extension. */
const FORMATS: Readonly<Record<string, { type: AssetKind; format: string }>> = {
  png: { type: 'image', format: 'png' },
  webp: { type: 'image', format: 'webp' },
  jpg: { type: 'image', format: 'jpeg' },
  jpeg: { type: 'image', format: 'jpeg' },
  wav: { type: 'audio', format: 'wav' },
  ogg: { type: 'audio', format: 'ogg' },
  mp3: { type: 'audio', format: 'mp3' },
};

/** Extensions an import accepts, for file pickers (".png,.wav,…"). */
export const IMPORT_EXTENSIONS = Object.keys(FORMATS).map((e) => `.${e}`);

function extension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** An asset's type from its extension, or null for files the game can't use. */
export function assetType(path: string): AssetKind | null {
  return FORMATS[extension(path)]?.type ?? null;
}

const startsWith = (bytes: Uint8Array, at: number, text: string) =>
  [...text].every((c, i) => bytes[at + i] === c.charCodeAt(0));

/** The format the bytes are actually in (by their signature), or null. */
export function sniffFormat(bytes: Uint8Array): string | null {
  if (bytes[0] === 0x89 && startsWith(bytes, 1, 'PNG')) return 'png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'webp';
  if (startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WAVE')) return 'wav';
  if (startsWith(bytes, 0, 'OggS')) return 'ogg';
  if (startsWith(bytes, 0, 'ID3')) return 'mp3';
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'mp3';
  return null;
}

/** A PNG's size from its header, or null if it isn't a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (sniffFormat(bytes) !== 'png' || bytes.length < 24 || !startsWith(bytes, 12, 'IHDR')) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

/**
 * A file name safe in any project folder and URL: no folders, no characters
 * file systems dislike, lower-case extension. Spaces are kept.
 */
export function safeAssetName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const ext = extension(base);
  const stem = [...(ext ? base.slice(0, -(ext.length + 1)) : base)]
    .map((c) => (c.charCodeAt(0) < 0x20 || ':*?"<>|#%'.includes(c) ? '-' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return `${stem || 'asset'}${ext ? `.${ext}` : ''}`;
}

/** `folder/name`, or `folder/name-2.ext` (-3, …) if that path is taken (case-insensitively). */
export function uniqueAssetPath(folder: string, name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((p) => p.toLowerCase()));
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = `${folder}/${name}`;
  for (let n = 2; used.has(candidate.toLowerCase()); n++)
    candidate = `${folder}/${stem}-${n}${ext}`;
  return candidate;
}

/** Why a file can't be imported, or null if it can. */
export function importProblem(name: string, bytes: Uint8Array): string | null {
  const expected = FORMATS[extension(name)];
  if (!expected) {
    return `${name}: not a supported file (images: PNG, WebP, JPEG; sound: WAV, OGG, MP3)`;
  }
  if (bytes.length === 0) return `${name}: the file is empty`;
  const actual = sniffFormat(bytes);
  if (actual !== expected.format) {
    return `${name}: the file's contents aren't ${expected.format.toUpperCase()}${actual ? ` (it looks like ${actual.toUpperCase()})` : ''}`;
  }
  return null;
}

export interface ImportFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

export interface ImportResult {
  readonly imported: readonly { readonly name: string; readonly path: string }[];
  readonly rejected: readonly { readonly name: string; readonly reason: string }[];
}

/** An image or sound file in the project. */
export interface AssetEntry {
  readonly path: string;
  readonly type: AssetKind;
  /** Where the project uses it (empty: unused, safe to delete). */
  readonly usedBy: readonly string[];
  /** Referenced by the data but not on disk. */
  readonly missing: boolean;
}

/**
 * Every image and sound under assets/ plus every one the data refers to that
 * isn't there (marked missing), sorted by path.
 */
export function describeAssets(
  project: OpenedProject,
  paths: readonly string[],
): readonly AssetEntry[] {
  const references = assetReferences(project);
  const entries = new Map<string, AssetEntry>();
  for (const path of paths) {
    const type = assetType(path);
    if (!type) continue;
    entries.set(path, {
      path,
      type,
      usedBy: references.get(path)?.usedBy ?? [],
      missing: false,
    });
  }
  for (const [path, use] of references) {
    if (!entries.has(path)) {
      entries.set(path, { path, type: use.kind, usedBy: use.usedBy, missing: true });
    }
  }
  return [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * The asset files of one project folder. Keeps the list of files under
 * assets/ and tells subscribers when it changes, so every picker sees an
 * import at once.
 */
export class AssetLibrary {
  private paths: readonly string[] | null = null;
  private loading: Promise<readonly string[]> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Bumped whenever the list changes. */
  version = 0;

  constructor(readonly fs: ProjectFs) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The list as last read (empty before the first `list()` finishes). */
  get listed(): readonly string[] {
    return this.paths ?? [];
  }

  private changed(paths: readonly string[]): void {
    this.paths = paths;
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Every file under assets/ (sorted); listed once, then kept up to date. */
  list(): Promise<readonly string[]> {
    if (this.paths) return Promise.resolve(this.paths);
    this.loading ??= this.fs.list(ASSETS_DIR).then((paths) => {
      this.loading = null;
      this.changed(paths);
      return paths;
    });
    return this.loading;
  }

  /** List the folder again (files may have been changed outside the editor). */
  async refresh(): Promise<readonly string[]> {
    this.paths = null;
    return this.list();
  }

  /**
   * Copy files into `folder` (under assets/). Never overwrites: a name that's
   * taken gets a number. Files that aren't usable images or sounds are
   * rejected with a reason; the rest are still imported.
   */
  async import(folder: string, files: readonly ImportFile[]): Promise<ImportResult> {
    const target = normalizeProjectPath(folder);
    if (target !== ASSETS_DIR && !target.startsWith(`${ASSETS_DIR}/`)) {
      throw new Error(`Assets go under ${ASSETS_DIR}/, not ${folder}`);
    }
    const taken = [...(await this.list())];
    const imported: { name: string; path: string }[] = [];
    const rejected: { name: string; reason: string }[] = [];
    for (const file of files) {
      const problem = importProblem(file.name, file.bytes);
      if (problem) {
        rejected.push({ name: file.name, reason: problem });
        continue;
      }
      const path = uniqueAssetPath(target, safeAssetName(file.name), taken);
      await this.fs.writeBytes(path, file.bytes);
      taken.push(path);
      imported.push({ name: file.name, path });
    }
    if (imported.length > 0) this.changed([...taken].sort());
    return { imported, rejected };
  }

  /** Delete an unused asset file. Refuses while the project still uses it. */
  async remove(project: OpenedProject, path: string): Promise<void> {
    const uses = assetReferences(project).get(path);
    if (uses) {
      throw new Error(`${path} is still used by ${uses.usedBy.join('; ')}`);
    }
    await this.fs.remove(path);
    const paths = await this.list();
    this.changed(paths.filter((p) => p !== path));
  }
}

/**
 * Where an imported file goes when the user chose `chosen`: there if the
 * folder holds that type of file, else the first folder for its type (so a
 * sound dropped while "Tilesets" is chosen still lands in assets/audio).
 */
export function importFolderFor(name: string, chosen: string): string {
  const type = assetType(name);
  const folder = ASSET_FOLDERS.find((f) => f.path === chosen);
  if (!type || folder?.type === type) return chosen;
  return ASSET_FOLDERS.find((f) => f.type === type)?.path ?? chosen;
}
