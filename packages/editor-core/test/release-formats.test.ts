// Released formats are frozen: a project exactly as each release wrote it
// (packages/schema/test/fixtures/release-<version>) must open in every later
// version with no problems. Their files must never change; change a format
// with a migration instead, and freeze the new release's folder here.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openProject, planExport } from '../src/index.js';
import { memoryCopy } from './helpers.js';

const FIXTURES = join(import.meta.dirname, '..', '..', 'schema', 'test', 'fixtures');

/** Each frozen release, with the checksum of its folder when it was frozen. */
const RELEASES = [
  { version: '0.1', checksum: '7ba90859d40fc8cfbaa4ae8759636ae242def54283dc5edd6bd167fdb382ae76' },
  { version: '0.2', checksum: 'e5408154b283e549b6b05b60919a9a2a3157dcdb7a5e6cd3183676ef9b5e5b65' },
] as const;

/** One checksum over every file's path and bytes. */
async function checksum(root: string): Promise<string> {
  const hash = createHash('sha256');
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const paths = entries
    .filter((e) => e.isFile())
    .map((e) => relative(root, join(e.parentPath, e.name)).split(sep).join('/'))
    .sort();
  for (const path of paths) {
    hash.update(`${path}\n`);
    hash.update(await readFile(join(root, path)));
  }
  return hash.digest('hex');
}

describe.each(RELEASES)('the frozen $version project', ({ version, checksum: frozen }) => {
  const root = join(FIXTURES, `release-${version}`);

  it('opens with no problems', async () => {
    const project = await openProject(await memoryCopy(root));
    expect(project.problems).toEqual([]);
    expect([...project.maps.keys()].sort()).toEqual(['house', 'map001']);
    expect(Object.keys(project.database).length).toBeGreaterThan(5);
  });

  it('plans an export with only missing art to report (the fixture has no assets)', async () => {
    const fs = await memoryCopy(root);
    const plan = await planExport(await openProject(fs), fs);
    expect(plan.errors.every((p) => /assets\//.test(`${p.source} ${p.message}`))).toBe(true);
  });

  it('has not been edited', async () => {
    expect(await checksum(root)).toBe(frozen);
  });
});
