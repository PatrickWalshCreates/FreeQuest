import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MemoryFs } from '../src/index.js';

export const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');

/**
 * Every file of a folder copied into a MemoryFs (so tests can break it
 * freely): JSON as text, everything else (images, audio) as bytes.
 */
export async function memoryCopy(root: string): Promise<MemoryFs> {
  const fs = new MemoryFs({}, root);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const full = join(entry.parentPath, entry.name);
    const path = relative(root, full).split(sep).join('/');
    if (entry.name.endsWith('.json')) await fs.writeText(path, await readFile(full, 'utf8'));
    else await fs.writeBytes(path, new Uint8Array(await readFile(full)));
  }
  return fs;
}

/**
 * The demo as it was before it had plugins (M15): its plugins unlisted, their
 * folders gone and their commands taken out, for tests that add their own.
 */
export async function demoWithoutPlugins(): Promise<MemoryFs> {
  const fs = await memoryCopy(DEMO);
  const manifest = JSON.parse(await fs.readText('project.json')) as Record<string, unknown>;
  delete manifest['plugins'];
  await fs.writeText('project.json', JSON.stringify(manifest));
  for (const path of await fs.list('plugins')) await fs.remove(path);
  const strip = (value: unknown): unknown =>
    Array.isArray(value)
      ? value
          .filter(
            (c) => !(c && typeof c === 'object' && (c as { type?: unknown }).type === 'plugin'),
          )
          .map(strip)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v)]))
        : value;
  for (const path of await fs.list('data/maps')) {
    await fs.writeText(path, JSON.stringify(strip(JSON.parse(await fs.readText(path)))));
  }
  return fs;
}
