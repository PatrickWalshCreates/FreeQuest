// M17 step 1: an MZ game's windows: the skin's background colour with the window
// tone, its main font and size, and Change window colour in events.
import { MemoryFs, openProject } from '@freequest/editor-core';
import type { SystemData } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { blankImage, importMzProject } from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

async function importWithWindows(options: { font?: boolean } = {}) {
  const source = await memoryCopy(TINY);
  // A skin whose background square is one colour (the rest of it doesn't matter here).
  const skin = blankImage(192, 192);
  for (let y = 0; y < 96; y++) {
    for (let x = 0; x < 96; x++) skin.data.set([40, 60, 120, 255], (y * 192 + x) * 4);
  }
  await source.writeBytes('img/system/Window.png', await codec.encode(skin));
  if (options.font !== false) {
    await source.writeBytes('fonts/round hand.woff', new Uint8Array([0x77, 0x4f, 0x46, 0x46]));
  }
  const path = 'data/System.json';
  const system = JSON.parse(await source.readText(path)) as Record<string, unknown>;
  system['windowTone'] = [20, -10, 0, 0];
  system['advanced'] = {
    ...(system['advanced'] as object),
    fontSize: 20,
    mainFontFilename: 'round hand.woff',
  };
  await source.writeText(path, JSON.stringify(system));
  const commons = JSON.parse(await source.readText('data/CommonEvents.json')) as {
    list: unknown[];
  }[];
  const first = commons[1];
  if (!first) throw new Error('fixture changed');
  first.list = [
    { code: 138, indent: 0, parameters: [[-40, -60, 0, 0]] },
    { code: 138, indent: 0, parameters: [[20, -10, 0, 0]] },
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

describe('MZ windows', () => {
  it('take the skin’s colour shifted by the tone, the font and its size', async () => {
    const { target } = await importWithWindows();
    const system = JSON.parse(await target.readText('data/database/system.json')) as SystemData;
    expect(system.ui).toEqual({
      font: 'assets/fonts/round-hand.woff',
      fontSize: 20,
      sharpText: true,
      lineHeight: 28,
      padding: 12,
      windowColor: '#3c3278',
      windowOpacity: 0.75,
    });
    expect(await target.readBytes('assets/fonts/round-hand.woff')).toHaveLength(4);
    const common = JSON.parse(await target.readText('data/database/commonEvents.json')) as {
      entries: { id: string; commands: unknown[] }[];
    };
    expect(common.entries.find((e) => e.id === 'open-gate')?.commands).toEqual([
      { type: 'changeWindowColor', windowColor: '#000078' },
      // The project's own tone: back to the project's colour.
      { type: 'changeWindowColor', windowColor: null },
    ]);
    expect((await openProject(target)).problems).toEqual([]);
  });

  it('use the system font when the font file is missing, and say so', async () => {
    const { target, report } = await importWithWindows({ font: false });
    const system = JSON.parse(await target.readText('data/database/system.json')) as SystemData;
    expect(system.ui?.font).toBeUndefined();
    expect(report.items.map((i) => i.message)).toContainEqual(
      'fonts/round hand.woff is missing, so windows use the system font.',
    );
  });
});
