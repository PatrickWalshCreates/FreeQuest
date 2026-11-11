// The 0.1 formats are frozen: a project exactly as FreeQuest 0.1.0 wrote it
// (packages/schema/test/fixtures/release-0.1) must open in every later
// version with no problems. Its files must never change; change a format
// with a migration instead.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openProject, planExport } from '../src/index.js';
import { memoryCopy } from './helpers.js';

const RELEASE_0_1 = join(
  import.meta.dirname,
  '..',
  '..',
  'schema',
  'test',
  'fixtures',
  'release-0.1',
);

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

describe('the frozen 0.1 project', () => {
  it('opens with no problems', async () => {
    const project = await openProject(await memoryCopy(RELEASE_0_1));
    expect(project.problems).toEqual([]);
    expect([...project.maps.keys()].sort()).toEqual(['house', 'map001']);
    expect(Object.keys(project.database).length).toBeGreaterThan(5);
  });

  it('plans an export with only missing art to report (the fixture has no assets)', async () => {
    const fs = await memoryCopy(RELEASE_0_1);
    const plan = await planExport(await openProject(fs), fs);
    expect(plan.errors.every((p) => /assets\//.test(`${p.source} ${p.message}`))).toBe(true);
  });

  it('has not been edited', async () => {
    expect(await checksum(RELEASE_0_1)).toBe(
      '7ba90859d40fc8cfbaa4ae8759636ae242def54283dc5edd6bd167fdb382ae76',
    );
  });
});
