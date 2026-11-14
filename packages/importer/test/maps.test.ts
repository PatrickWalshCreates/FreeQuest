import { MemoryFs, openProject } from '@freequest/editor-core';
import type { GameMap, Tileset } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { floorJoins, importMzProject, tileSource, wallJoins } from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

describe('MZ tile numbers', () => {
  it('find plain tiles on their sheets', () => {
    expect(tileSource(0)).toBeNull();
    expect(tileSource(1)).toEqual({ kind: 'tile', sheet: 'B', col: 1, row: 0 });
    expect(tileSource(130)).toEqual({ kind: 'tile', sheet: 'B', col: 10, row: 0 });
    expect(tileSource(256 + 44)).toEqual({ kind: 'tile', sheet: 'C', col: 4, row: 5 });
    expect(tileSource(1536 + 12)).toEqual({ kind: 'tile', sheet: 'A5', col: 4, row: 1 });
    expect(tileSource(9000)).toBeNull();
  });

  it('give each floor shape its own set of joined neighbours', () => {
    const key = (s: number) => JSON.stringify(floorJoins(s));
    expect(new Set(Array.from({ length: 47 }, (_, s) => key(s))).size).toBe(47);
    expect(floorJoins(0)).toMatchObject({ n: true, e: true, s: true, w: true, nw: true });
    expect(floorJoins(1)).toMatchObject({ nw: false, ne: true });
    expect(floorJoins(16)).toMatchObject({ w: false, n: true });
    expect(floorJoins(34)).toMatchObject({ n: false, w: false, e: true, s: true, se: true });
    expect(floorJoins(46)).toMatchObject({ n: false, e: false, s: false, w: false });
    expect(wallJoins(5)).toMatchObject({ w: false, e: false, n: true, s: true });
  });

  it('assemble autotiles from edge, corner and middle pieces', () => {
    const pieces = (id: number) => {
      const source = tileSource(id);
      return source?.kind === 'pieces' ? source.pieces.map((p) => [p.sx, p.sy]) : null;
    };
    const A2 = 2816;
    // Alone: the four outer corners of the bordered area.
    expect(pieces(A2 + 46)).toEqual([
      [0, 2],
      [3, 2],
      [0, 5],
      [3, 5],
    ]);
    // Joined all round: the middle.
    expect(pieces(A2)).toEqual([
      [2, 4],
      [1, 4],
      [2, 3],
      [1, 3],
    ]);
    // Missing the top-left corner: an inside corner piece there.
    expect(pieces(A2 + 1)).toEqual([
      [2, 0],
      [1, 4],
      [2, 3],
      [1, 3],
    ]);
    // The second A2 kind starts two tiles to the right.
    expect(pieces(A2 + 48 + 46)?.[0]).toEqual([4, 2]);
    // A wall (A3) joined above and below only.
    expect(pieces(4352 + 5)).toEqual([
      [0, 2],
      [3, 2],
      [0, 1],
      [3, 1],
    ]);
  });
});

/** FreeQuest's rule: walkable iff some tile collides and every colliding tile is walkable. */
function walkable(map: GameMap, tileset: Tileset, x: number, y: number): boolean {
  const tiles = map.layers
    .map((l) => l.data[y]?.[x] ?? -1)
    .filter((t) => t >= 0)
    .map((t) => tileset.tiles[t])
    .filter((t) => t && !t.above);
  return tiles.length > 0 && tiles.every((t) => t?.passable);
}

describe('importing maps', () => {
  async function run() {
    const target = new MemoryFs();
    const result = await importMzProject(await memoryCopy(TINY), target, {
      template: await starter(),
      images: codec,
    });
    const map = JSON.parse(await target.readText('data/maps/hollow.json')) as GameMap;
    const tileset = JSON.parse(await target.readText('data/tilesets/hollow.json')) as Tileset;
    const messages = (where: string) =>
      result.report.items.filter((i) => i.where === where).map((i) => i.message);
    return { target, result, map, tileset, messages };
  }

  it('keeps the layers in use and walks like MZ: bridges over water, treetops above', async () => {
    const { map, tileset } = await run();
    expect(map).toMatchObject({
      id: 'hollow',
      name: 'Hollow',
      width: 4,
      height: 3,
      tileset: 'hollow',
      events: [],
    });
    expect(map.layers.map((l) => l.name)).toEqual(['ground', 'upper']);
    const grid = [0, 1, 2].map((y) =>
      [0, 1, 2, 3].map((x) => (walkable(map, tileset, x, y) ? '.' : '#')).join(''),
    );
    expect(grid).toEqual([
      '.#..', // grass, water, bridge over water, grass under a treetop
      '#.##', // rock, fence (blocked one way only), water, nothing
      '....',
    ]);
    // The treetop is drawn above characters.
    const top = map.layers[1]?.data[0]?.[3] ?? -1;
    expect(tileset.tiles[top]).toMatchObject({ above: true });
    // Water appears twice: blocked, and walkable under the bridge.
    const water = new Set([map.layers[0]?.data[0]?.[1], map.layers[0]?.data[0]?.[2]]);
    expect(water.size).toBe(2);
    expect(tileset).toMatchObject({
      tileWidth: 48,
      tileHeight: 48,
      image: 'assets/tilesets/hollow.png',
    });
  });

  it('draws baked tiles from the right pieces of the sheets', async () => {
    const { target, map, tileset } = await run();
    const image = await codec.decode(await target.readBytes(tileset.image));
    const pixel = (tile: number, x: number, y: number) => {
      const px = (tile % tileset.columns) * 48 + x;
      const py = Math.floor(tile / tileset.columns) * 48 + y;
      const i = (py * image.width + px) * 4;
      return [...image.data.subarray(i, i + 3)];
    };
    // The synthetic sheets colour each quarter by where it is: [column × 8, row × 8, sheet].
    const lone = map.layers[0]?.data[0]?.[0] ?? -1; // grass alone: outer corners
    expect(pixel(lone, 2, 2)).toEqual([0, 16, 2]);
    expect(pixel(lone, 30, 30)).toEqual([24, 40, 2]);
    const middle = map.layers[0]?.data[2]?.[0] ?? -1; // grass joined all round: the middle
    expect(pixel(middle, 2, 2)).toEqual([16, 32, 2]);
    const rock = map.layers[1]?.data[1]?.[0] ?? -1; // B tile 3: fourth tile of the sheet
    expect(pixel(rock, 2, 2)).toEqual([48, 0, 5]);
  });

  it('brings encounters and the start, and reports what differs', async () => {
    const { target, map, messages } = await run();
    expect(map.encounters).toEqual({ steps: 25, troops: [{ troop: 'moth-2', weight: 10 }] });
    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    expect(project.manifest.data.start).toMatchObject({
      map: 'hollow',
      x: 3,
      y: 2,
      direction: 'down',
    });
    expect(project.manifest.data.maps).toEqual([{ id: 'hollow', path: 'data/maps/hollow.json' }]);
    expect(project.manifest.data.tilesets).toEqual([
      { id: 'hollow', path: 'data/tilesets/hollow.json' },
    ]);
    // The Starter's own map and tileset are gone.
    expect(target.binaries.has('assets/tilesets/overworld.png')).toBe(false);
    expect(messages('Maps › Hollow').join('\n')).toMatch(
      /1 tile is passable from some sides[\s\S]*shadows[\s\S]*certain regions/,
    );
    expect(messages("Maps › Keeper's house")).toEqual([
      'data/Map003.json is missing, so the map was left out.',
    ]);
    expect(messages('Tilesets › Hollow').join()).toMatch(/water shows its first frame/);
    expect(messages('Maps').join()).toMatch(/1 map shows its name/);
  });
});
