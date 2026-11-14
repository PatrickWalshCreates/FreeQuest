import { MemoryFs, openProject } from '@freequest/editor-core';
import type { CharacterSheet } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { GraphicsImporter, ImportReport, importMzProject } from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

/** The synthetic art colours each frame by where it is: [column × 16, row × 16, sheet]. */
async function pixel(fs: MemoryFs, path: string, x: number, y: number) {
  const image = await codec.decode(await fs.readBytes(path));
  const i = (y * image.width + x) * 4;
  return { size: [image.width, image.height], rgb: [...image.data.subarray(i, i + 3)] };
}

describe('importing pictures', () => {
  async function run() {
    const target = new MemoryFs();
    const result = await importMzProject(await memoryCopy(TINY), target, {
      template: await starter(),
      images: codec,
    });
    const project = await openProject(target);
    const messages = (where: string) =>
      result.report.items.filter((i) => i.where === where).map((i) => i.message);
    return { target, project, messages };
  }

  it('cuts each used character out of its sheet, and the player looks like the leader', async () => {
    const { target, project } = await run();
    expect(project.problems).toEqual([]);
    const manifest = project.manifest.data;
    expect(manifest.characters.map((c) => c.id)).toEqual(['lamplighters-6', 'tamsin']);
    expect(manifest.player.character).toBe('lamplighters-6');
    const sheet = JSON.parse(
      await target.readText('data/characters/lamplighters-6.json'),
    ) as CharacterSheet;
    expect(sheet).toMatchObject({
      name: 'Lamplighters 6',
      image: 'assets/characters/lamplighters-6.png',
      frameWidth: 48,
      frameHeight: 48,
      frames: 3,
      rows: ['down', 'left', 'right', 'up'],
      idleFrame: 1,
      walkCycle: [0, 1, 2, 1],
    });
    // Character 6 is the second block of the second row: frames from column 3, row 4.
    expect(await pixel(target, sheet.image, 0, 0)).toEqual({ size: [144, 192], rgb: [48, 64, 10] });
    expect(await pixel(target, sheet.image, 143, 191)).toEqual({
      size: [144, 192],
      rgb: [80, 112, 10],
    });
    // A "$" sheet is one character.
    expect(await pixel(target, 'assets/characters/tamsin.png', 0, 0)).toEqual({
      size: [144, 192],
      rgb: [0, 0, 11],
    });
    const actors = JSON.parse(await target.readText('data/database/actors.json')) as {
      entries: { id: string; character: string }[];
    };
    expect(actors.entries.map((a) => a.character)).toEqual(['lamplighters-6', 'tamsin']);
    // Nothing uses the Starter's hero now, so it isn't copied.
    expect(target.files.has('data/characters/hero.json')).toBe(false);
    expect(target.binaries.has('assets/characters/hero.png')).toBe(false);
  });

  it('copies enemy images and the icon sheet', async () => {
    const { target, messages } = await run();
    const enemies = JSON.parse(await target.readText('data/database/enemies.json')) as {
      entries: { id: string; image?: string }[];
    };
    expect(enemies.entries.map((e) => e.image)).toEqual(['assets/enemies/moth.png', undefined]);
    expect((await pixel(target, 'assets/enemies/moth.png', 0, 0)).rgb).toEqual([0, 0, 13]);
    expect(messages('Enemies › Moth').join()).toMatch(/recoloured/);
    expect(messages('Enemies › Shade').join()).toMatch(/img\/enemies\/Shadeling\.png is missing/);
    const system = JSON.parse(await target.readText('data/database/system.json')) as {
      iconset: unknown;
    };
    expect(system.iconset).toEqual({
      image: 'assets/system/iconset.png',
      iconSize: 32,
      columns: 16,
    });
    expect((await pixel(target, 'assets/system/iconset.png', 0, 0)).rgb).toEqual([0, 0, 14]);
  });

  it('lays a face sheet out in a row, keeping each face’s number', async () => {
    const source = await memoryCopy(TINY);
    const report = new ImportReport();
    const graphics = new GraphicsImporter(source, codec, report);
    expect(await graphics.face('Lamplighters_face', 6, 'Test')).toEqual({
      image: 'assets/faces/lamplighters_face.png',
      index: 6,
    });
    expect(await graphics.face('Nobody', 0, 'Test')).toBeNull();
    expect(report.items.map((i) => i.message).join()).toMatch(/img\/faces\/Nobody\.png is missing/);
    const out = await graphics.finish();
    const face = out.files.find((f) => f.path === 'assets/faces/lamplighters_face.png');
    if (!face) throw new Error('no face sheet');
    const image = await codec.decode(face.bytes);
    expect([image.width, image.height]).toEqual([1152, 144]);
    // Face 6 was the third face of MZ's second row.
    const i = (0 * image.width + 6 * 144) * 4;
    expect([...image.data.subarray(i, i + 3)]).toEqual([32, 16, 12]);
  });

  it('finds side-view enemy images, and says when a picture is encrypted', async () => {
    const source = await memoryCopy(TINY);
    await source.writeBytes(
      'img/sv_enemies/Wisp.png',
      await source.readBytes('img/enemies/Moth.png'),
    );
    await source.writeBytes('img/enemies/Ghost.png_', new Uint8Array([1, 2, 3]));
    const report = new ImportReport();
    const graphics = new GraphicsImporter(source, codec, report, true);
    expect(await graphics.enemy('Wisp', 'A')).toBe('assets/enemies/wisp.png');
    // Not in sv_enemies, but in enemies: still found.
    expect(await graphics.enemy('Moth', 'B')).toBe('assets/enemies/moth.png');
    expect(await new GraphicsImporter(source, codec, report).enemy('Ghost', 'C')).toBeNull();
    expect(report.items).toEqual([
      {
        level: 'missing',
        where: 'C',
        message: expect.stringMatching(/img\/enemies\/Ghost\.png is encrypted/),
      },
    ]);
  });

  it('falls back to the Starter’s hero for an actor without a picture', async () => {
    const source = await memoryCopy(TINY);
    const actors = JSON.parse(await source.readText('data/Actors.json')) as ({
      characterName: string;
    } | null)[];
    const second = actors[2];
    if (second) second.characterName = '';
    await source.writeText('data/Actors.json', JSON.stringify(actors));
    const target = new MemoryFs();
    const result = await importMzProject(source, target, {
      template: await starter(),
      images: codec,
    });
    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    expect(project.manifest.data.characters.map((c) => c.id)).toContain('hero');
    expect(
      result.report.items.filter((i) => i.where === 'Actors › Tamsin').map((i) => i.message),
    ).toContain('It has no character picture, so it uses the Starter’s hero.');
  });
});
