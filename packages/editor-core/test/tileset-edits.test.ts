import type { Tileset } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  MANIFEST_PATH,
  ProjectDocument,
  createMap,
  createTileset,
  deleteTileset,
  fitTileset,
  fitsImage,
  openProject,
  setAbove,
  setPassable,
  setTileName,
  tileGrid,
  tilesetPath,
  tilesetUsages,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const base: Tileset = {
  formatVersion: 1,
  id: 'ts',
  name: 'TS',
  image: 'assets/tilesets/ts.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: 2,
  tiles: [{ passable: true, name: 'grass' }, { passable: false }, { passable: true, above: true }],
};

async function demo() {
  const fs = await memoryCopy(DEMO);
  const doc = new ProjectDocument(await openProject(fs));
  return { fs, doc };
}

describe('tileset grid', () => {
  it('counts whole tiles in an image', () => {
    expect(tileGrid(128, 96, 32, 32)).toEqual({ columns: 4, rows: 3 });
    expect(tileGrid(100, 40, 32, 32)).toEqual({ columns: 3, rows: 1 });
    expect(tileGrid(10, 10, 32, 32)).toEqual({ columns: 1, rows: 1 });
  });

  it('fits tiles to the image, keeping flags by index', () => {
    const fitted = fitTileset(base, 48, 32);
    expect(fitted.columns).toBe(3);
    expect(fitted.tiles).toHaveLength(6);
    expect(fitted.tiles.slice(0, 3)).toEqual(base.tiles);
    expect(fitted.tiles[5]).toEqual({ passable: true });
    expect(fitTileset(base, 32, 16).tiles).toEqual(base.tiles.slice(0, 2));
  });

  it('changes the tile size', () => {
    const fitted = fitTileset(base, 64, 64, 32, 32);
    expect(fitted).toMatchObject({ tileWidth: 32, tileHeight: 32, columns: 2 });
    expect(fitted.tiles).toHaveLength(4);
  });

  it('returns the same tileset when it already fits', () => {
    const exact = { ...base, tiles: [...base.tiles, { passable: true }] };
    expect(fitTileset(exact, 32, 32)).toBe(exact);
    expect(fitsImage(exact, 32, 32)).toBe(true);
    expect(fitsImage(exact, 48, 32)).toBe(false);
  });
});

describe('tile flags', () => {
  it('sets walkability and keeps untouched tiles', () => {
    const next = setPassable(base, [0, 1, 9], false);
    expect(next.tiles.map((t) => t.passable)).toEqual([false, false, true]);
    expect(next.tiles[1]).toBe(base.tiles[1]);
    expect(setPassable(base, [1], false)).toBe(base);
  });

  it('sets and clears "above" without leaving false behind', () => {
    const on = setAbove(base, [0], true);
    expect(on.tiles[0]).toEqual({ passable: true, name: 'grass', above: true });
    const off = setAbove(on, [0, 2], false);
    expect(off.tiles[0]).toEqual({ passable: true, name: 'grass' });
    expect(off.tiles[2]).toEqual({ passable: true });
    expect(setAbove(base, [2], true)).toBe(base);
  });

  it('names tiles, and an empty name removes it', () => {
    expect(setTileName(base, 1, ' rock ').tiles[1]).toEqual({ passable: false, name: 'rock' });
    expect(setTileName(base, 0, '').tiles[0]).toEqual({ passable: true });
    expect(setTileName(base, 0, 'grass')).toBe(base);
  });
});

describe('tileset files', () => {
  it('creates a tileset cut from an image, in one undo step', async () => {
    const { doc } = await demo();
    const id = createTileset(doc, {
      name: 'Caves',
      image: 'assets/tilesets/overworld.png',
      imageWidth: 128,
      imageHeight: 96,
      tileWidth: 32,
      tileHeight: 32,
    });
    expect(id).toBe('caves');
    const file = doc.project.tilesets.get('caves');
    expect(file?.path).toBe(tilesetPath('caves'));
    expect(file?.data).toMatchObject({ name: 'Caves', columns: 4 });
    expect(file?.data?.tiles).toHaveLength(12);
    expect(doc.project.problems).toEqual([]);
    expect(createTileset(doc, { ...sample(), name: 'Caves' })).toBe('caves-2');
    doc.undo();
    doc.undo();
    expect(doc.project.tilesets.has('caves')).toBe(false);
    expect(doc.isDirty(MANIFEST_PATH)).toBe(false);
  });

  it('refuses bad sizes', async () => {
    const { doc } = await demo();
    expect(() => createTileset(doc, { ...sample(), name: ' ' })).toThrow(/name/);
    expect(() => createTileset(doc, { ...sample(), tileWidth: 0 })).toThrow(/whole numbers/);
    expect(() => createTileset(doc, { ...sample(), tileWidth: 512 })).toThrow(/bigger/);
  });

  it('deletes only unused tilesets', async () => {
    const { doc } = await demo();
    expect(tilesetUsages(doc.project, 'overworld').length).toBeGreaterThan(0);
    expect(() => deleteTileset(doc, 'overworld')).toThrow(/Maps still use/);
    const id = createTileset(doc, sample());
    deleteTileset(doc, id);
    expect(doc.project.tilesets.has(id)).toBe(false);
    expect(doc.project.manifest.data.tilesets.map((t) => t.id)).toEqual(['overworld']);
  });

  it('reports map tiles a shrunk tileset no longer has', async () => {
    const { doc } = await demo();
    const id = createTileset(doc, sample());
    createMap(doc, { name: 'Cave', width: 4, height: 4, tileset: id, fillTile: 3 });
    expect(doc.project.problems).toEqual([]);
    doc.update(tilesetPath(id), 'tileset', 'Shrink', (t) => fitTileset(t, 64, 32));
    expect(doc.project.problems.map((p) => p.message)).toEqual([
      expect.stringMatching(/uses tile 3, but tileset "tiles" has only 2 tiles/),
    ]);
  });
});

function sample() {
  return {
    name: 'Tiles',
    image: 'assets/tilesets/overworld.png',
    imageWidth: 128,
    imageHeight: 128,
    tileWidth: 32,
    tileHeight: 32,
  };
}
