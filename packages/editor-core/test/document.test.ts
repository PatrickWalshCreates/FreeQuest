import { EMPTY_TILE, type GameMap, MAP_FORMAT_VERSION, stableStringify } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import type { MemoryFs } from '../src/index.js';
import {
  HISTORY_LIMIT,
  ProjectDocument,
  SaveBlockedError,
  openProject,
  setTiles,
  tileAt,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const MAP = 'data/maps/map001.json';
const HOUSE = 'data/maps/house.json';

async function demoDocument(fs?: MemoryFs) {
  const memory = fs ?? (await memoryCopy(DEMO));
  return { fs: memory, doc: new ProjectDocument(await openProject(memory)) };
}

const rename = (doc: ProjectDocument, name: string, coalesce?: string) =>
  doc.update(MAP, 'map', 'Rename map', (m) => ({ ...m, name }), coalesce ? { coalesce } : {});

const mapName = (doc: ProjectDocument) => doc.project.maps.get('map001')?.data?.name;

describe('ProjectDocument editing', () => {
  it('starts clean and shows edits in the project view', async () => {
    const { doc } = await demoDocument();
    expect(doc.dirty).toBe(false);
    expect(doc.canUndo).toBe(false);
    const version = doc.version;
    let notified = 0;
    doc.subscribe(() => notified++);

    expect(rename(doc, 'Green Meadow')).toBe(true);
    expect(mapName(doc)).toBe('Green Meadow');
    expect(doc.dirtyPaths).toEqual([MAP]);
    expect(doc.isDirty(HOUSE)).toBe(false);
    expect(doc.version).toBe(version + 1);
    expect(notified).toBe(1);
    expect(doc.undoLabel).toBe('Rename map');
  });

  it('ignores edits that change nothing', async () => {
    const { doc } = await demoDocument();
    expect(doc.update(MAP, 'map', 'Nothing', (m) => m)).toBe(false);
    expect(doc.canUndo).toBe(false);
    expect(doc.dirty).toBe(false);
  });

  it('undoes and redoes, and is clean again back at the saved state', async () => {
    const { doc } = await demoDocument();
    const original = doc.file(MAP)?.data;
    rename(doc, 'One');
    rename(doc, 'Two');
    expect(doc.undo()).toBe('Rename map');
    expect(mapName(doc)).toBe('One');
    expect(doc.undo()).toBe('Rename map');
    expect(doc.file(MAP)?.data).toBe(original);
    expect(doc.dirty).toBe(false);
    expect(doc.undo()).toBeNull();

    expect(doc.redo()).toBe('Rename map');
    expect(mapName(doc)).toBe('One');
    expect(doc.dirty).toBe(true);
    expect(doc.canRedo).toBe(true);
    // A new edit drops the redo history.
    rename(doc, 'Three');
    expect(doc.canRedo).toBe(false);
    expect(doc.redo()).toBeNull();
  });

  it('merges coalesced edits into one step until endCoalescing', async () => {
    const { doc } = await demoDocument();
    rename(doc, 'M', 'name');
    rename(doc, 'Me', 'name');
    rename(doc, 'Mea', 'name');
    doc.endCoalescing();
    rename(doc, 'Meadow!', 'name');
    expect(doc.undo()).toBe('Rename map');
    expect(mapName(doc)).toBe('Mea');
    doc.undo();
    expect(mapName(doc)).toBe('Meadow');
    expect(doc.canUndo).toBe(false);
  });

  it('does not merge different keys, or across an undo', async () => {
    const { doc } = await demoDocument();
    rename(doc, 'A', 'one');
    rename(doc, 'B', 'two');
    doc.undo();
    rename(doc, 'C', 'one');
    expect(mapName(doc)).toBe('C');
    doc.undo();
    expect(mapName(doc)).toBe('A');
  });

  it('drops a coalesced step that ends where it started', async () => {
    const { doc } = await demoDocument();
    rename(doc, 'Meadows', 'name');
    rename(doc, 'Meadow', 'name');
    expect(doc.canUndo).toBe(false);
    expect(doc.dirty).toBe(false);
  });

  it(`keeps the last ${HISTORY_LIMIT} steps`, async () => {
    const { doc } = await demoDocument();
    for (let i = 0; i <= HISTORY_LIMIT; i++) rename(doc, `Name ${i}`);
    let steps = 0;
    while (doc.undo()) steps++;
    expect(steps).toBe(HISTORY_LIMIT);
    expect(mapName(doc)).toBe('Name 0');
    // 400 steps, each rechecking the whole project: slow CI machines need longer.
  }, 30_000);

  it('updates problems as data changes', async () => {
    const { doc } = await demoDocument();
    expect(doc.project.problems).toEqual([]);
    doc.update(MAP, 'map', 'Change tileset', (m) => ({ ...m, tileset: 'missing' }));
    expect(doc.project.problems.map((p) => p.source)).toContain('references');
    doc.update(MAP, 'map', 'Shrink', (m) => ({ ...m, width: m.width - 1 }));
    expect(doc.project.problems).toContainEqual({
      source: MAP,
      message: expect.stringContaining('row'),
    });
    doc.undo();
    doc.undo();
    expect(doc.project.problems).toEqual([]);
  });

  it('refuses to edit missing, mistyped or unloadable files', async () => {
    const fs = await memoryCopy(DEMO);
    fs.files.set(HOUSE, '{');
    const { doc } = await demoDocument(fs);
    expect(() => doc.update('nope.json', 'map', 'x', (m) => m)).toThrow(/not part/);
    expect(() => doc.update(MAP, 'tileset', 'x', (t) => t)).toThrow(/is a map file/);
    expect(() => doc.update(HOUSE, 'map', 'x', (m) => m)).toThrow(/could not be loaded/);
  });
});

describe('ProjectDocument saving', () => {
  it('writes only changed files, in canonical form, and is clean afterwards', async () => {
    const { fs, doc } = await demoDocument();
    const writes: string[] = [];
    const write = fs.writeText.bind(fs);
    fs.writeText = (path, text) => {
      writes.push(path);
      return write(path, text);
    };
    rename(doc, 'Green Meadow');
    doc.update('project.json', 'manifest', 'Rename game', (m) => ({ ...m, name: 'Renamed' }));
    doc.update(HOUSE, 'map', 'Rename', (m) => ({ ...m, name: 'Cottage' }));

    const result = await doc.save();
    // project.json goes last.
    expect(result.written).toEqual([MAP, HOUSE, 'project.json']);
    expect(writes).toEqual(result.written);
    expect(doc.dirty).toBe(false);
    const saved = await fs.readText(MAP);
    expect(saved).toBe(stableStringify(doc.file(MAP)?.data));
    expect((JSON.parse(saved) as GameMap).name).toBe('Green Meadow');

    // Undo after saving makes the file differ from disk again.
    doc.undo();
    expect(doc.isDirty(HOUSE)).toBe(true);
    expect((await doc.save()).written).toEqual([HOUSE]);
  });

  it('saves nothing when nothing changed', async () => {
    const { doc } = await demoDocument();
    expect(await doc.save()).toEqual({ written: [], removed: [] });
  });

  it('round-trips the demo byte for byte', async () => {
    const { fs, doc } = await demoDocument();
    const before = await fs.readText(MAP);
    rename(doc, 'X');
    rename(doc, 'Meadow');
    await doc.save();
    expect(await fs.readText(MAP)).toBe(before);
  });

  it('refuses to write anything when a changed file fails the schema', async () => {
    const { fs, doc } = await demoDocument();
    const before = await fs.readText(HOUSE);
    doc.update(HOUSE, 'map', 'Rename', (m) => ({ ...m, name: 'Cottage' }));
    doc.update(MAP, 'map', 'Break', (m) => ({ ...m, name: 42 as unknown as string }));
    await expect(doc.save()).rejects.toBeInstanceOf(SaveBlockedError);
    expect(await fs.readText(HOUSE)).toBe(before);
    expect(doc.dirtyPaths).toEqual([MAP, HOUSE]);
    expect(doc.project.problems.some((p) => p.source === MAP)).toBe(true);
    // Fixing it lets the save through.
    doc.undo();
    expect((await doc.save()).written).toEqual([HOUSE]);
  });

  it('treats files in an older format as changed, and upgrades them on save', async () => {
    const fs = await memoryCopy(DEMO);
    const house = JSON.parse(await fs.readText(HOUSE)) as Record<string, unknown>;
    delete house['music'];
    fs.files.set(HOUSE, JSON.stringify({ ...house, formatVersion: 4 }));
    const { doc } = await demoDocument(fs);
    expect(doc.dirtyPaths).toEqual([HOUSE]);
    expect(doc.project.maps.get('house')?.migrated).toBe(true);
    await doc.save();
    expect(doc.dirty).toBe(false);
    expect(doc.project.maps.get('house')?.migrated).toBe(false);
    expect((JSON.parse(await fs.readText(HOUSE)) as { formatVersion: number }).formatVersion).toBe(
      MAP_FORMAT_VERSION,
    );
  });

  it('keeps edits made during a save unsaved, and runs saves one at a time', async () => {
    const { fs, doc } = await demoDocument();
    const write = fs.writeText.bind(fs);
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    fs.writeText = async (path, text) => {
      await gate;
      return write(path, text);
    };
    rename(doc, 'First');
    const first = doc.save();
    rename(doc, 'Second');
    const second = doc.save();
    release();
    expect((await first).written).toEqual([MAP]);
    expect((await second).written).toEqual([MAP]);
    expect((JSON.parse(await fs.readText(MAP)) as GameMap).name).toBe('Second');
    expect(doc.dirty).toBe(false);
  });

  it('keeps files that failed to write dirty', async () => {
    const { fs, doc } = await demoDocument();
    fs.writeText = (path) => Promise.reject(new Error(`disk full: ${path}`));
    rename(doc, 'X');
    await expect(doc.save()).rejects.toThrow(/disk full/);
    expect(doc.dirtyPaths).toEqual([MAP]);
  });
});

describe('setTiles', () => {
  const map = (): GameMap => ({
    formatVersion: 6,
    id: 'm',
    name: 'm',
    width: 3,
    height: 2,
    tileset: 't',
    layers: [
      {
        name: 'a',
        data: [
          [0, 0, 0],
          [1, 1, 1],
        ],
      },
      {
        name: 'b',
        data: [
          [-1, -1, -1],
          [-1, -1, -1],
        ],
      },
    ],
    events: [],
  });

  it('copies only the rows and layer it changes', () => {
    const before = map();
    const after = setTiles(before, 0, [{ x: 1, y: 0, tile: 5 }]);
    expect(tileAt(after, 0, 1, 0)).toBe(5);
    expect(tileAt(before, 0, 1, 0)).toBe(0);
    expect(after.layers[0]?.data[1]).toBe(before.layers[0]?.data[1]);
    expect(after.layers[1]).toBe(before.layers[1]);
    expect(after.events).toBe(before.events);
  });

  it('returns the same map when nothing changes', () => {
    const before = map();
    expect(setTiles(before, 0, [{ x: 0, y: 0, tile: 0 }])).toBe(before);
    expect(
      setTiles(before, 0, [
        { x: 9, y: 0, tile: 3 },
        { x: -1, y: 0, tile: 3 },
      ]),
    ).toBe(before);
    expect(
      setTiles(before, 0, [
        { x: 0, y: 0, tile: 3 },
        { x: 0, y: 0, tile: 0 },
      ]),
    ).toBe(before);
  });

  it('clears cells with EMPTY_TILE and rejects unknown layers', () => {
    const after = setTiles(map(), 0, [{ x: 2, y: 1, tile: EMPTY_TILE }]);
    expect(tileAt(after, 0, 2, 1)).toBe(EMPTY_TILE);
    expect(tileAt(after, 0, 5, 5)).toBe(EMPTY_TILE);
    expect(() => setTiles(map(), 2, [])).toThrow(RangeError);
  });

  it('works as a document edit', async () => {
    const { doc } = await demoDocument();
    const paint = (tile: number) =>
      doc.update(MAP, 'map', 'Paint tiles', (m) => setTiles(m, 0, [{ x: 0, y: 0, tile }]), {
        coalesce: 'stroke',
      });
    const original = tileAt(doc.project.maps.get('map001')?.data as GameMap, 0, 0, 0);
    paint(original === 1 ? 2 : 1);
    expect(paint(original === 1 ? 2 : 1)).toBe(false);
    doc.undo();
    expect(tileAt(doc.project.maps.get('map001')?.data as GameMap, 0, 0, 0)).toBe(original);
  });
});
