import { normalizeProjectPath } from './paths.js';
import { decodeUtf8, encodeUtf8 } from './utf8.js';

/**
 * The editor's view of a project folder. Paths are project-relative with `/`
 * separators (see `normalizeProjectPath`). Implementations: the desktop app
 * (Tauri file system), the browser dev server, and `MemoryFs` for tests.
 */
export interface ProjectFs {
  /** Shown to the user, e.g. the folder path. */
  readonly label: string;
  /** Read a text file. Rejects with `FileNotFoundError` when it doesn't exist. */
  readText(path: string): Promise<string>;
  writeText(path: string, text: string): Promise<void>;
  /** Read any file as bytes (images, audio). Rejects with `FileNotFoundError` when missing. */
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  /** Delete a file. Deleting a file that doesn't exist is not an error. */
  remove(path: string): Promise<void>;
  /**
   * Every file under a folder (recursively), as project-relative paths in
   * sorted order. A missing folder lists as empty.
   */
  list(dir: string): Promise<string[]>;
  /** A URL an <img> or texture loader can use for a project asset (images, audio). */
  assetUrl(path: string): Promise<string>;
}

export class FileNotFoundError extends Error {
  override name = 'FileNotFoundError';
  constructor(readonly path: string) {
    super(`File not found: ${path}`);
  }
}

/** An in-memory project folder, for tests and new unsaved projects. */
export class MemoryFs implements ProjectFs {
  /** Text files by path. */
  readonly files = new Map<string, string>();
  /** Binary files by path (kept apart so tests can treat `files` as text). */
  readonly binaries = new Map<string, Uint8Array>();

  constructor(
    files: Record<string, string> = {},
    readonly label = 'memory',
  ) {
    for (const [path, text] of Object.entries(files))
      this.files.set(normalizeProjectPath(path), text);
  }

  // async so invalid paths reject like every other failure.
  async readText(path: string): Promise<string> {
    const key = normalizeProjectPath(path);
    const text = this.files.get(key);
    if (text !== undefined) return text;
    const bytes = this.binaries.get(key);
    if (bytes) return decodeUtf8(bytes);
    throw new FileNotFoundError(path);
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const key = normalizeProjectPath(path);
    const bytes = this.binaries.get(key);
    if (bytes) return bytes;
    const text = this.files.get(key);
    if (text !== undefined) return encodeUtf8(text);
    throw new FileNotFoundError(path);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const key = normalizeProjectPath(path);
    this.files.delete(key);
    this.binaries.set(key, bytes);
  }

  async writeText(path: string, text: string): Promise<void> {
    const key = normalizeProjectPath(path);
    this.binaries.delete(key);
    this.files.set(key, text);
  }

  async remove(path: string): Promise<void> {
    const key = normalizeProjectPath(path);
    this.files.delete(key);
    this.binaries.delete(key);
  }

  async list(dir: string): Promise<string[]> {
    const prefix = `${normalizeProjectPath(dir)}/`;
    return [...this.files.keys(), ...this.binaries.keys()]
      .filter((path) => path.startsWith(prefix))
      .sort();
  }

  async assetUrl(path: string): Promise<string> {
    return `memory:${normalizeProjectPath(path)}`;
  }
}
