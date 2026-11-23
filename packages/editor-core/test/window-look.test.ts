// M17 step 1: a project's window font is an asset like any other (exports carry
// it, a missing one only warns, the reference index finds it, moves update it),
// and Change window colour reads well in the command list.
import type { SystemData } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  ProjectDocument,
  assetReferences,
  describeCommand,
  moveAsset,
  openProject,
  planExport,
  referencesTo,
} from '../src/index.js';
import { demoWithoutPlugins } from './helpers.js';

const FONT = 'assets/fonts/pixel.ttf';

async function project(withFile = true) {
  const fs = await demoWithoutPlugins();
  if (withFile) await fs.writeBytes(FONT, new Uint8Array([0, 1, 0, 0, 9]));
  const path = 'data/database/system.json';
  const system = JSON.parse(await fs.readText(path)) as SystemData;
  await fs.writeText(
    path,
    JSON.stringify({ ...system, ui: { font: FONT, fontSize: 8, windowColor: '#203040' } }),
  );
  return { fs, opened: await openProject(fs) };
}

describe('the window font', () => {
  it('is exported and indexed', async () => {
    const { fs, opened } = await project();
    expect(opened.problems).toEqual([]);
    expect(assetReferences(opened).get(FONT)).toEqual({
      kind: 'font',
      usedBy: ['system window font'],
    });
    expect(referencesTo(opened, 'asset', FONT)).toHaveLength(1);
    const plan = await planExport(opened, fs);
    expect(plan.files).toContainEqual({ kind: 'asset', path: FONT });
  });

  it('only warns when it’s missing (the game uses the system font)', async () => {
    const { fs, opened } = await project(false);
    const plan = await planExport(opened, fs);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings.map((w) => w.message)).toContainEqual(
      expect.stringMatching(/^font not found \(used by system window font\)/),
    );
  });

  it('follows a moved file', async () => {
    const { opened } = await project();
    const doc = new ProjectDocument(opened);
    await moveAsset(doc, FONT, 'assets/fonts/round.ttf');
    expect(doc.project.database.system?.data?.ui?.font).toBe('assets/fonts/round.ttf');
  });
});

describe('Change window colour', () => {
  it('describes itself', () => {
    const names = { troop: (id: string) => id } as never;
    expect(describeCommand({ type: 'changeWindowColor', windowColor: '#3a2030' }, names)).toBe(
      'Window colour: #3a2030',
    );
    expect(describeCommand({ type: 'changeWindowColor', windowColor: null }, names)).toBe(
      'Window colour: the project’s own',
    );
  });
});
