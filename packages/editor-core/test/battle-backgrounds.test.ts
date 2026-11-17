// M16 step 1: battle backgrounds are assets like any other: exports carry
// them, the reference index finds them, and moving the file updates them.
import type { GameMap, SystemData } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  ProjectDocument,
  assetReferences,
  moveAsset,
  openProject,
  referencesTo,
} from '../src/index.js';
import { demoWithoutPlugins } from './helpers.js';

async function project() {
  const fs = await demoWithoutPlugins();
  for (const name of ['sky', 'meadow', 'cave', 'storm']) {
    await fs.writeBytes(`assets/battlebacks/${name}.png`, new Uint8Array([1]));
  }
  const edit = async <T>(path: string, change: (data: T) => T) =>
    fs.writeText(path, JSON.stringify(change(JSON.parse(await fs.readText(path)) as T)));
  await edit<SystemData>('data/database/system.json', (s) => ({
    ...s,
    battleBackground: 'assets/battlebacks/sky.png',
  }));
  await edit<GameMap>('data/maps/map001.json', (m) => ({
    ...m,
    battleBackground: 'assets/battlebacks/meadow.png',
    events: [
      ...m.events,
      {
        id: 'ambush',
        name: 'Ambush',
        x: 0,
        y: 0,
        pages: [
          {
            conditions: [],
            trigger: 'action',
            layer: 'same',
            commands: [
              { type: 'changeBattleBackground', image: 'assets/battlebacks/storm.png' },
              {
                type: 'battle',
                troop: 'slimes',
                canEscape: true,
                canLose: false,
                background: 'assets/battlebacks/cave.png',
              },
            ],
          },
        ],
      },
    ],
  }));
  return { fs, opened: await openProject(fs) };
}

describe('battle backgrounds as assets', () => {
  it('are exported and indexed wherever they’re set', async () => {
    const { opened } = await project();
    expect(opened.problems).toEqual([]);
    const assets = assetReferences(opened);
    expect(assets.get('assets/battlebacks/sky.png')?.usedBy).toEqual(['system battle background']);
    expect(assets.get('assets/battlebacks/meadow.png')?.usedBy).toEqual([
      'map Meadow: battle background',
    ]);
    expect(assets.has('assets/battlebacks/cave.png')).toBe(true);
    expect(assets.has('assets/battlebacks/storm.png')).toBe(true);
    for (const name of ['sky', 'meadow', 'cave', 'storm']) {
      expect(referencesTo(opened, 'asset', `assets/battlebacks/${name}.png`), name).toHaveLength(1);
    }
  });

  it('follow a moved file', async () => {
    const { opened } = await project();
    const doc = new ProjectDocument(opened);
    await moveAsset(doc, 'assets/battlebacks/cave.png', 'assets/battlebacks/deep-cave.png');
    expect(referencesTo(doc.project, 'asset', 'assets/battlebacks/deep-cave.png')).toHaveLength(1);
    expect(referencesTo(doc.project, 'asset', 'assets/battlebacks/cave.png')).toEqual([]);
  });
});
