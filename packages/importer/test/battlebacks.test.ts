// M16 step 1: MZ's battle backgrounds (two images: the ground, then walls or
// sky over it) become one picture: the project's (MZ's battle test one), a
// map's own when it names one, and Change battle background in events.
import { MemoryFs, openProject } from '@freequest/editor-core';
import type { GameMap, SystemData } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { blankImage, importMzProject } from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

/** A small solid image: `top` paints only its upper half (like a skyline over the ground). */
async function png(color: [number, number, number], top = false) {
  const image = blankImage(4, 4);
  for (let i = 0; i < 16; i++) {
    if (top && i >= 8) continue;
    image.data.set([...color, 255], i * 4);
  }
  return codec.encode(image);
}

async function importWithBattlebacks() {
  const source = await memoryCopy(TINY);
  await source.writeBytes('img/battlebacks1/Grass Field.png', await png([0, 200, 0]));
  await source.writeBytes('img/battlebacks2/Forest.png', await png([0, 0, 200], true));
  await source.writeBytes('img/battlebacks1/Cave.png', await png([90, 90, 90]));
  const edit = async (path: string, change: (data: Record<string, unknown>) => void) => {
    const data = JSON.parse(await source.readText(path)) as Record<string, unknown>;
    change(data);
    await source.writeText(path, JSON.stringify(data));
  };
  await edit('data/System.json', (s) => {
    s['battleback1Name'] = 'Grass Field';
    s['battleback2Name'] = 'Forest';
  });
  await edit('data/Map001.json', (m) => {
    m['specifyBattleback'] = true;
    m['battleback1Name'] = 'Cave';
    m['battleback2Name'] = '';
  });
  const commons = JSON.parse(await source.readText('data/CommonEvents.json')) as {
    list: unknown[];
  }[];
  const first = commons[1];
  if (!first) throw new Error('fixture changed');
  first.list = [
    { code: 283, indent: 0, parameters: ['Grass Field', 'Forest'] },
    { code: 283, indent: 0, parameters: ['Nowhere', ''] },
    { code: 0, indent: 0, parameters: [] },
  ];
  await source.writeText('data/CommonEvents.json', JSON.stringify(commons));
  const target = new MemoryFs();
  const { report } = await importMzProject(source, target, {
    template: await starter(),
    images: codec,
  });
  return { target, report };
}

describe('MZ battle backgrounds', () => {
  it('become one layered picture per pair, for the project, maps and events', async () => {
    const { target, report } = await importWithBattlebacks();
    const system = JSON.parse(await target.readText('data/database/system.json')) as SystemData;
    expect(system.battleBackground).toBe('assets/battlebacks/grass-field-forest.png');
    const layered = await codec.decode(
      await target.readBytes('assets/battlebacks/grass-field-forest.png'),
    );
    // The top half is the forest image, the bottom half the grass under it.
    expect([...layered.data.slice(0, 3)]).toEqual([0, 0, 200]);
    expect([...layered.data.slice(12 * 4, 12 * 4 + 3)]).toEqual([0, 200, 0]);

    const map = JSON.parse(await target.readText('data/maps/hollow.json')) as GameMap;
    expect(map.battleBackground).toBe('assets/battlebacks/cave.png');

    const common = JSON.parse(await target.readText('data/database/commonEvents.json')) as {
      entries: { id: string; commands: unknown[] }[];
    };
    expect(common.entries.find((e) => e.id === 'open-gate')?.commands).toEqual([
      { type: 'changeBattleBackground', image: 'assets/battlebacks/grass-field-forest.png' },
      {
        type: 'comment',
        text: 'From MZ, not imported: Change battle background: pictures that aren’t there',
      },
    ]);
    expect(report.items.map((i) => i.message)).toContainEqual(
      'img/battlebacks1/Nowhere.png is missing.',
    );
    // The template's own battle background isn't copied.
    expect(await target.list('assets/battlebacks')).toEqual([
      'assets/battlebacks/cave.png',
      'assets/battlebacks/grass-field-forest.png',
    ]);
    expect((await openProject(target)).problems).toEqual([]);
  });

  it('say when MZ would have chosen one from the ground', async () => {
    const target = new MemoryFs();
    const { report } = await importMzProject(await memoryCopy(TINY), target, {
      template: await starter(),
      images: codec,
    });
    expect(report.items.filter((i) => i.message.includes('battle background'))).toMatchObject([
      {
        where: 'Maps',
        message:
          "1 map lets MZ choose the battle background from the ground; it uses the project's (Database › System), none yet.",
      },
    ]);
  });
});
