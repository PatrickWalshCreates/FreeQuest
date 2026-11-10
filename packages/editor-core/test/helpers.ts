import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MemoryFs } from '../src/index.js';

export const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');

/** Every JSON file of a folder, copied into a MemoryFs (so tests can break it freely). */
export async function memoryCopy(root: string): Promise<MemoryFs> {
  const fs = new MemoryFs({}, root);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const full = join(entry.parentPath, entry.name);
    await fs.writeText(relative(root, full).split(sep).join('/'), await readFile(full, 'utf8'));
  }
  return fs;
}
