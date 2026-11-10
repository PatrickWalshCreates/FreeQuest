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
