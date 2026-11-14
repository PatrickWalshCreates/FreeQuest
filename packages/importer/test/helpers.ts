import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { MemoryFs, type TemplateSource } from '@freequest/editor-core';
import { PNG } from 'pngjs';
import type { ImageCodec } from '../src/index.js';

export const FIXTURES = join(import.meta.dirname, 'fixtures');
export const TINY = join(FIXTURES, 'tiny-mz');
export const STARTER = join(import.meta.dirname, '..', '..', '..', 'templates', 'starter');

/** Every file of a folder in a MemoryFs, all as bytes (so text keeps its exact bytes). */
export async function memoryCopy(root: string): Promise<MemoryFs> {
  const fs = new MemoryFs({}, root);
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith('.')) continue;
    const full = join(entry.parentPath, entry.name);
    await fs.writeBytes(
      relative(root, full).split(sep).join('/'),
      new Uint8Array(await readFile(full)),
    );
  }
  return fs;
}

export async function starter(): Promise<TemplateSource> {
  const fs = await memoryCopy(STARTER);
  return { files: await fs.list(''), read: (path) => fs.readBytes(path) };
}

/** PNGs through pngjs, as the CLI does. */
export const codec: ImageCodec = {
  async decode(bytes) {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  },
  async encode(image) {
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.data);
    return new Uint8Array(PNG.sync.write(png));
  },
};
