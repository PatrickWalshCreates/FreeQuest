// Save slots as files, for the desktop player. SaveStore is synchronous (the
// menus are simple state machines), so every save file is read up front and
// kept in memory; changes are written through to disk in the background, in
// order. Free of Tauri so it can be tested with any FileApi.
import type { KeyValueStorage } from '@freequest/runtime';

/** The few file operations save files need, relative to the saves folder. */
export interface FileApi {
  /** File names in the folder (none if it doesn't exist yet). */
  list(): Promise<string[]>;
  read(name: string): Promise<string>;
  write(name: string, text: string): Promise<void>;
  remove(name: string): Promise<void>;
}

/** A storage key → a file name ("freequest:game:demo:save:1" → "freequest_game_demo_save_1.json"). */
export function saveFileName(key: string): string {
  return `${key.replace(/[^a-z0-9-]/gi, '_')}.json`;
}

export class FileSaveStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();
  private queue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly files: FileApi,
    private readonly onError: (error: unknown) => void,
  ) {}

  /** Read every save file into memory. Files that can't be read are skipped (and reported). */
  static async open(
    files: FileApi,
    onError: (error: unknown) => void = (e) => console.error(e),
  ): Promise<FileSaveStorage> {
    const storage = new FileSaveStorage(files, onError);
    for (const name of await files.list()) {
      if (!name.endsWith('.json')) continue;
      try {
        const text = await files.read(name);
        const { key, value } = JSON.parse(text) as { key?: unknown; value?: unknown };
        if (typeof key === 'string' && typeof value === 'string') storage.values.set(key, value);
      } catch (error) {
        onError(error);
      }
    }
    return storage;
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
    // Each file holds its key too, so names never need decoding.
    this.enqueue(() => this.files.write(saveFileName(key), JSON.stringify({ key, value })));
  }

  removeItem(key: string): void {
    this.values.delete(key);
    this.enqueue(() => this.files.remove(saveFileName(key)));
  }

  /** Resolves when every write so far has reached the disk. */
  flush(): Promise<void> {
    return this.queue;
  }

  private enqueue(task: () => Promise<void>): void {
    this.queue = this.queue.then(task).catch(this.onError);
  }
}
