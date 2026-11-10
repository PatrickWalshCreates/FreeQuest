// ProjectFs over a folder on disk, for the command line.
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileNotFoundError, type ProjectFs, normalizeProjectPath } from '@freequest/editor-core';

export class NodeFs implements ProjectFs {
  readonly label: string;
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
    this.label = this.root;
  }

  /** The absolute path of a project path; normalizeProjectPath keeps it inside the root. */
  private full(path: string): string {
    return join(this.root, ...normalizeProjectPath(path).split('/'));
  }

  private async read(path: string): Promise<Buffer> {
    const full = this.full(path);
    try {
      return await readFile(full);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new FileNotFoundError(path);
      throw error;
    }
  }

  async readText(path: string): Promise<string> {
    return (await this.read(path)).toString('utf8');
  }

  async readBytes(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.read(path));
  }

  async writeText(path: string, text: string): Promise<void> {
    const full = this.full(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text);
  }

  async writeBytes(path: string, bytes: Uint8Array): Promise<void> {
    const full = this.full(path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, bytes);
  }

  async remove(path: string): Promise<void> {
    await rm(this.full(path), { force: true });
  }

  async list(dir: string): Promise<string[]> {
    const full = this.full(dir);
    if (!existsSync(full)) return [];
    const entries = await readdir(full, { recursive: true, withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => relative(this.root, join(e.parentPath, e.name)).split(sep).join('/'))
      .sort();
  }

  async assetUrl(path: string): Promise<string> {
    return pathToFileURL(this.full(path)).href;
  }
}
