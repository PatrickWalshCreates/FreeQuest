// ProjectFs over the desktop file system (Tauri fs plugin). Folders picked
// in the open dialog are added to the plugin's scope, so the app can only
// touch folders the user chose.
import { FileNotFoundError, type ProjectFs, normalizeProjectPath } from '@freequest/editor-core';
import { open } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readFile, readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

const MIME: Record<string, string> = { png: 'image/png', wav: 'audio/wav', ogg: 'audio/ogg' };

export class TauriFs implements ProjectFs {
  private readonly urls = new Map<string, Promise<string>>();

  constructor(private readonly root: string) {}

  get label(): string {
    return this.root;
  }

  private full(path: string): string {
    return `${this.root.replace(/[\\/]+$/, '')}/${normalizeProjectPath(path)}`;
  }

  async readText(path: string): Promise<string> {
    const full = this.full(path);
    if (!(await exists(full))) throw new FileNotFoundError(path);
    return readTextFile(full);
  }

  async writeText(path: string, text: string): Promise<void> {
    const full = this.full(path);
    await mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
    await writeTextFile(full, text);
  }

  /** Assets become blob URLs, cached for the life of the project. */
  assetUrl(path: string): Promise<string> {
    let url = this.urls.get(path);
    if (!url) {
      url = (async () => {
        const bytes = await readFile(this.full(path));
        const type = MIME[path.slice(path.lastIndexOf('.') + 1).toLowerCase()] ?? '';
        return URL.createObjectURL(new Blob([bytes], { type }));
      })();
      this.urls.set(path, url);
    }
    return url;
  }

  /** Release the blob URLs (when the project closes). */
  dispose(): void {
    for (const url of this.urls.values()) void url.then((u) => URL.revokeObjectURL(u));
    this.urls.clear();
  }
}

/** Ask the user for a project folder. Null when they cancel. */
export async function pickProjectFolder(): Promise<string | null> {
  const picked = await open({
    directory: true,
    recursive: true,
    title: 'Open a FreeQuest project',
  });
  return typeof picked === 'string' ? picked : null;
}
