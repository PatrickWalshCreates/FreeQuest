import { MAP_FORMAT_VERSION } from '@freequest/schema';
import { EMPTY_TILE, type GameMap } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  MemoryFs,
  ProjectDocument,
  TileStroke,
  type TileTool,
  floodCells,
  lineCells,
  openProject,
  rectCells,
  type Stamp,
  copyArea,
  clearArea,
  paletteStamp,
  singleTileOf,
  tileAt,
  tileStamp,
} from '../src/index.js';

const PATH = 'data/maps/m.json';

// A 5×4 map: layer 0 is tile 0 with a wall of 1s down column 2; layer 1 is empty.
function mapData(): GameMap {
  const ground = [0, 1, 2, 3].map(() => [0, 0, 1, 0, 0]);
  return {
    formatVersion: MAP_FORMAT_VERSION,
    id: 'm',
    name: 'Test',
    width: 5,
    height: 4,
    tileset: 't',
    layers: [
      { name: 'ground', data: ground },
      { name: 'top', data: ground.map((row) => row.map(() => EMPTY_TILE)) },
    ],
    events: [],
  };
}

async function setup() {
  const fs = new MemoryFs({
    'project.json': JSON.stringify({
      formatVersion: 4,
      name: 'Test',
      screen: { width: 160, height: 128 },
      start: { map: 'm', x: 0, y: 0, direction: 'down', party: [], gold: 0 },
      player: { character: 'c', speed: 4 },
      tilesets: [{ id: 't', path: 'data/t.json' }],
      maps: [{ id: 'm', path: PATH }],
      characters: [{ id: 'c', path: 'data/c.json' }],
      switches: [],
      variables: [],
    }),
    'data/t.json': JSON.stringify({
      formatVersion: 1,
      id: 't',
      name: 'T',
      image: 't.png',
      tileWidth: 32,
      tileHeight: 32,
      columns: 4,
      tiles: [{ passable: true }, { passable: false }, { passable: true }, { passable: true }],
    }),
    'data/c.json': JSON.stringify({
      formatVersion: 1,
      id: 'c',
      name: 'C',
      image: 'c.png',
      frameWidth: 32,
      frameHeight: 32,
      frames: 3,
      rows: ['down', 'left', 'right', 'up'],
      idleFrame: 1,
      walkCycle: [0, 1, 2, 1],
    }),
    [PATH]: JSON.stringify(mapData()),
  });
  const doc = new ProjectDocument(await openProject(fs));
  expect(doc.project.problems).toEqual([]);
  const map = () => doc.file(PATH)?.data as GameMap;
  const stroke = (tool: TileTool, x: number, y: number, tile: number | Stamp = 3, layer = 0) =>
    new TileStroke(
      { doc, path: PATH, layer, tool, stamp: typeof tile === 'number' ? tileStamp(tile) : tile },
      { x, y },
    );
  /** Layer rows as strings, "." for empty. */
  const rows = (layer = 0): string[] =>
    map().layers[layer]?.data.map((r) => r.map((t) => (t === EMPTY_TILE ? '.' : t)).join('')) ?? [];
  return { doc, map, stroke, rows };
}

describe('tool geometry', () => {
  it('draws gapless lines in any direction', () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 3, y: 0 })).toHaveLength(4);
    expect(lineCells({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
    const diagonal = lineCells({ x: 3, y: 3 }, { x: 0, y: 1 });
    expect(diagonal[0]).toEqual({ x: 3, y: 3 });
    expect(diagonal.at(-1)).toEqual({ x: 0, y: 1 });
    // Each step moves at most one cell on each axis.
    for (let i = 1; i < diagonal.length; i++) {
      const [a, b] = [diagonal[i - 1], diagonal[i]];
      expect(Math.abs((a?.x ?? 0) - (b?.x ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((a?.y ?? 0) - (b?.y ?? 0))).toBeLessThanOrEqual(1);
    }
  });

  it('covers rectangles from any two corners', () => {
    expect(rectCells({ x: 2, y: 1 }, { x: 0, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
  });

  it('floods the connected same-tile area only', () => {
    const map = mapData();
    expect(floodCells(map, 0, { x: 0, y: 0 })).toHaveLength(8); // left of the wall
    expect(floodCells(map, 0, { x: 2, y: 3 })).toHaveLength(4); // the wall itself
    expect(floodCells(map, 1, { x: 4, y: 3 })).toHaveLength(20); // all empty
    expect(floodCells(map, 0, { x: 9, y: 9 })).toEqual([]);
  });
});

describe('TileStroke', () => {
  it('paints a dragged pencil stroke without gaps, as one undo step', async () => {
    const { doc, stroke, rows } = await setup();
    const s = stroke('pencil', 0, 0);
    s.moveTo({ x: 4, y: 3 }); // pointer jumped: the line between is painted too
    s.finish();
    expect(rows()).toEqual(['30100', '03100', '00330', '00103']);
    expect(doc.undoLabel).toBe('Paint tiles');
    doc.undo();
    expect(rows()).toEqual(['00100', '00100', '00100', '00100']);
    expect(doc.canUndo).toBe(false);
  });

  it('makes separate strokes separate undo steps', async () => {
    const { doc, stroke } = await setup();
    stroke('pencil', 0, 0).finish();
    stroke('pencil', 1, 0).finish();
    doc.undo();
    expect(doc.canUndo).toBe(true);
  });

  it('skips cells outside the map', async () => {
    const { stroke, rows } = await setup();
    const s = stroke('pencil', 3, 0);
    s.moveTo({ x: 7, y: 0 });
    s.finish();
    expect(rows()[0]).toBe('00133');
  });

  it('erases on the chosen layer', async () => {
    const { stroke, rows } = await setup();
    stroke('pencil', 1, 1, 2, 1).finish();
    expect(rows(1)?.[1]).toBe('.2...');
    stroke('eraser', 1, 1, 2, 1).finish();
    expect(rows(1)?.[1]).toBe('.....');
    expect(rows()[1]).toBe('00100');
  });

  it('previews a rectangle and paints it on release', async () => {
    const { doc, stroke, rows } = await setup();
    const s = stroke('rectangle', 3, 1);
    s.moveTo({ x: 9, y: 2 });
    expect(rows()[1]).toBe('00100'); // nothing painted yet
    expect(s.preview.map((c) => `${c.x},${c.y}`)).toEqual(['3,1', '4,1', '3,2', '4,2']);
    s.finish();
    expect(s.preview).toEqual([]);
    expect(rows()).toEqual(['00100', '00133', '00133', '00100']);
    expect(doc.undoLabel).toBe('Draw rectangle');
  });

  it('fills a connected area', async () => {
    const { doc, stroke, rows } = await setup();
    stroke('fill', 4, 0, 2).finish();
    expect(rows()).toEqual(['00122', '00122', '00122', '00122']);
    expect(doc.undoLabel).toBe('Fill area');
  });

  it('picks the tile under the eyedropper without changing anything', async () => {
    const { doc, stroke } = await setup();
    expect(stroke('eyedropper', 2, 0).picked).toBe(1);
    expect(stroke('eyedropper', 2, 0, 0, 1).picked).toBe(EMPTY_TILE);
    expect(doc.canUndo).toBe(false);
  });

  it('makes no undo step when painting changes nothing', async () => {
    const { doc, stroke } = await setup();
    stroke('pencil', 0, 0, 0).finish();
    stroke('fill', 0, 0, 0).finish();
    expect(doc.canUndo).toBe(false);
  });

  it('cancels: undoes a pencil stroke, drops a rectangle, keeps earlier work', async () => {
    const { doc, stroke, rows, map } = await setup();
    stroke('pencil', 0, 0).finish();
    const s = stroke('pencil', 0, 1);
    s.moveTo({ x: 1, y: 1 });
    s.cancel();
    expect(rows()[1]).toBe('00100');
    expect(tileAt(map(), 0, 0, 0)).toBe(3);
    const r = stroke('rectangle', 0, 2);
    r.moveTo({ x: 4, y: 3 });
    r.cancel();
    expect(rows()[2]).toBe('00100');
    expect(doc.undoLabel).toBe('Paint tiles');
    // A cancelled stroke that painted nothing doesn't undo the previous one.
    stroke('pencil', 0, 0).cancel();
    expect(tileAt(map(), 0, 0, 0)).toBe(3);
  });
});

describe('stamps', () => {
  /** A 2 × 2 stamp of tiles 5 6 / 7 8. */
  const block: Stamp = {
    width: 2,
    height: 2,
    layers: [
      [
        [5, 6],
        [7, 8],
      ],
    ],
  };

  it('cut from the palette as a block, leaving out cells past the last tile', () => {
    const tileset = { columns: 4, tiles: new Array(10).fill({ passable: true }) } as never;
    expect(paletteStamp(tileset, { x: 3, y: 1 }, { x: 2, y: 0 })).toEqual({
      width: 2,
      height: 2,
      layers: [
        [
          [2, 3],
          [6, 7],
        ],
      ],
    });
    expect(paletteStamp(tileset, { x: 1, y: 2 }, { x: 2, y: 2 }).layers).toEqual([
      [[9, EMPTY_TILE]],
    ]);
    expect(singleTileOf(tileStamp(4))).toBe(4);
    expect(singleTileOf(block)).toBeNull();
  });

  it('places a whole stamp at a click, clipped to the map', async () => {
    const { stroke, rows } = await setup();
    stroke('pencil', 3, 2, block).finish();
    expect(rows()).toEqual(['00100', '00100', '00156', '00178']);
    stroke('pencil', 4, 3, block).finish(); // only its top-left tile fits
    expect(rows()[3]).toBe('00175');
  });

  it('drags copies on a grid of stamp-sized blocks, as one undo step', async () => {
    const { doc, stroke, rows } = await setup();
    const s = stroke('pencil', 0, 0, block);
    s.moveTo({ x: 1, y: 0 }); // same block: nothing new
    s.moveTo({ x: 3, y: 1 }); // next block over
    s.finish();
    // Blocks at (0, 0) and (2, 0); the second covers the wall in column 2.
    expect(rows()).toEqual(['56560', '78780', '00100', '00100']);
    doc.undo();
    expect(rows()).toEqual(['00100', '00100', '00100', '00100']);
  });

  it('fills rectangles and areas with the stamp as a pattern', async () => {
    const { stroke, rows } = await setup();
    const r = stroke('rectangle', 0, 0, block);
    r.moveTo({ x: 2, y: 2 });
    expect(r.preview).toHaveLength(9);
    r.finish();
    expect(rows().slice(0, 3)).toEqual(['56500', '78700', '56500']);
    const { stroke: fill, rows: rows2 } = await setup();
    // The area right of the wall (columns 3 and 4), patterned from (4, 0): column 4 starts the
    // stamp, column 3 is the stamp's second column wrapped round.
    fill('fill', 4, 0, block).finish();
    expect(rows2()).toEqual(['00165', '00187', '00165', '00187']);
  });

  it('copies an area with every layer (or one), and pastes it exactly, clearing too', async () => {
    const { doc, map, stroke, rows } = await setup();
    stroke('pencil', 1, 1, 9, 1).finish(); // something on the top layer
    const all = copyArea(map(), { x: 0, y: 0 }, { x: 2, y: 1 });
    expect(all?.layers).toEqual([
      [
        [0, 0, 1],
        [0, 0, 1],
      ],
      [
        [EMPTY_TILE, EMPTY_TILE, EMPTY_TILE],
        [EMPTY_TILE, 9, EMPTY_TILE],
      ],
    ]);
    expect(copyArea(map(), { x: 1, y: 1 }, { x: 1, y: 1 }, 1)?.layers).toEqual([[[9]]]);
    expect(copyArea(map(), { x: 9, y: 9 }, { x: 12, y: 12 })).toBeNull();
    // Paste it over the right side: the wall cell is copied as 1, the top layer's gaps clear.
    stroke('pencil', 2, 2, 7, 1).finish();
    if (!all) throw new Error('copy');
    stroke('pencil', 2, 2, all).finish();
    expect(rows().slice(2)).toEqual(['00001', '00001']);
    expect(rows(1).slice(2)).toEqual(['.....', '...9.']);
    doc.update('data/maps/m.json', 'map', 'Cut', (m) =>
      clearArea(m, { x: 0, y: 0 }, { x: 4, y: 0 }),
    );
    expect(rows()[0]).toBe('.....');
  });
});
