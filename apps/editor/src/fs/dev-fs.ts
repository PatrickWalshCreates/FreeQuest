// ProjectFs over the dev server's /__freequest endpoints (see dev-fs-plugin.ts).
import { FileNotFoundError, type ProjectFs, normalizeProjectPath } from '@freequest/editor-core';

const BASE = '/__freequest';

export class DevServerFs implements ProjectFs {
  readonly label: string;

  constructor(private readonly project: string) {
    this.label = `samples/${project}`;
  }

  private url(path: string): string {
    const segments = [this.project, ...normalizeProjectPath(path).split('/')];
    return `${BASE}/fs/${segments.map(encodeURIComponent).join('/')}`;
  }

  async readText(path: string): Promise<string> {
    const response = await fetch(this.url(path));
    if (response.status === 404) throw new FileNotFoundError(path);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.text();
  }

  async writeText(path: string, text: string): Promise<void> {
    const response = await fetch(this.url(path), { method: 'PUT', body: text });
    if (!response.ok) throw new Error(`Saving ${path} failed: HTTP ${response.status}`);
  }

  async assetUrl(path: string): Promise<string> {
    return this.url(path);
  }
}

/** Sample projects the dev server can open. */
export async function listDevProjects(): Promise<string[]> {
  const response = await fetch(`${BASE}/projects`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return (await response.json()) as string[];
}
