import { normalizeProjectPath } from './paths.js';

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
  readonly files = new Map<string, string>();

  constructor(
    files: Record<string, string> = {},
    readonly label = 'memory',
  ) {
    for (const [path, text] of Object.entries(files))
      this.files.set(normalizeProjectPath(path), text);
  }

  // async so invalid paths reject like every other failure.
  async readText(path: string): Promise<string> {
    const text = this.files.get(normalizeProjectPath(path));
    if (text === undefined) throw new FileNotFoundError(path);
    return text;
  }

  async writeText(path: string, text: string): Promise<void> {
    this.files.set(normalizeProjectPath(path), text);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(normalizeProjectPath(path));
  }

  async list(dir: string): Promise<string[]> {
    const prefix = `${normalizeProjectPath(dir)}/`;
    return [...this.files.keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  async assetUrl(path: string): Promise<string> {
    return `memory:${normalizeProjectPath(path)}`;
  }
}
