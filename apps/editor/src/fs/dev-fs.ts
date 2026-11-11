// ProjectFs over the dev server's /__freequest endpoints (see dev-fs-plugin.ts).
import {
  FileNotFoundError,
  type ProjectFs,
  type WriteOptions,
  normalizeProjectPath,
} from '@freequest/editor-core';

const BASE = '/__freequest';

/** Folders the dev server offers: sample projects, and where browser-mode exports go. */
export type DevArea = 'samples' | 'projects' | 'exports';

export class DevServerFs implements ProjectFs {
  readonly label: string;

  constructor(
    private readonly project: string,
    private readonly area: DevArea = 'samples',
  ) {
    this.label = `${area}/${project}`;
  }

  private url(path: string): string {
    const segments = [this.project, ...normalizeProjectPath(path).split('/')];
    return `${BASE}/${this.area}/fs/${segments.map(encodeURIComponent).join('/')}`;
  }

  async readText(path: string): Promise<string> {
    const response = await fetch(this.url(path));
    if (response.status === 404) throw new FileNotFoundError(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const response = await fetch(this.url(path));
    if (response.status === 404) throw new FileNotFoundError(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async writeBytes(path: string, bytes: Uint8Array, options: WriteOptions = {}): Promise<void> {
    const response = await fetch(this.url(path), {
      method: 'PUT',
      body: bytes as BodyInit,
      headers: options.executable ? { 'X-Freequest-Executable': '1' } : {},
    });
    if (!response.ok) throw new Error(`Saving ${path} failed: HTTP ${response.status}`);
  }

  async writeText(path: string, text: string): Promise<void> {
    const response = await fetch(this.url(path), { method: 'PUT', body: text });
    if (!response.ok) throw new Error(`Saving ${path} failed: HTTP ${response.status}`);
  }

  async remove(path: string): Promise<void> {
    const response = await fetch(this.url(path), { method: 'DELETE' });
    if (!response.ok) throw new Error(`Deleting ${path} failed: HTTP ${response.status}`);
  }

  async list(dir: string): Promise<string[]> {
    const segments = [this.project, ...(dir === '' ? [] : normalizeProjectPath(dir).split('/'))];
    const response = await fetch(
      `${BASE}/${this.area}/list/${segments.map(encodeURIComponent).join('/')}`,
    );
    if (!response.ok) throw new Error(`Listing ${dir} failed: HTTP ${response.status}`);
    return (await response.json()) as string[];
  }

  async assetUrl(path: string): Promise<string> {
    return this.url(path);
  }
}

/** Projects the dev server can open: samples, and ones made with New project. */
export async function listDevProjects(): Promise<{ area: DevArea; name: string }[]> {
  const response = await fetch(`${BASE}/projects`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as { area: DevArea; name: string }[];
}
