import {
  type Command,
  EMPTY_TILE,
  type GameMap,
  type Manifest,
  walkCommands,
} from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  MapOperationError,
  ProjectDocument,
  applyResize,
  createMap,
  deleteMap,
  duplicateMap,
  mapUsages,
  newMapData,
  nextMapId,
  openProject,
  resizeMap,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

async function demo() {
  const fs = await memoryCopy(DEMO);
  const doc = new ProjectDocument(await openProject(fs));
  const map = (id: string) => doc.project.maps.get(id)?.data as GameMap;
  const manifest = () => doc.project.manifest.data as Manifest;
  return { fs, doc, map, manifest };
}

function transfers(map: GameMap): Extract<Command, { type: 'transfer' }>[] {
  const found: Extract<Command, { type: 'transfer' }>[] = [];
  for (const event of map.events) {
    for (const page of event.pages) {
      walkCommands(page.commands, (c) => {
        if (c.type === 'transfer') found.push(c);
      });
    }
  }
  return found;
}

describe('document file changes', () => {
  it('creates and deletes files as undoable, saveable changes', async () => {
    const { fs, doc } = await demo();
    doc.edit('Add', (tx) =>
      tx.create(
        'data/extra.json',
        'map',
        'extra',
        newMapData('extra', {
          name: 'Extra',
          width: 2,
          height: 2,
          tileset: 'overworld',
        }),
      ),
    );
    expect(doc.file('data/extra.json')?.data).toBeTruthy();
    expect(doc.dirtyPaths).toEqual(['data/extra.json']);
    doc.undo();
    expect(doc.file('data/extra.json')).toBeUndefined();
    expect(doc.dirty).toBe(false);
    doc.redo();
    expect((await doc.save()).written).toEqual(['data/extra.json']);
    expect(await fs.readText('data/extra.json')).toContain('"Extra"');

    doc.edit('Remove', (tx) => tx.remove('data/extra.json'));
    expect(doc.isDirty('data/extra.json')).toBe(true);
    expect(await doc.save()).toEqual({ written: [], removed: ['data/extra.json'] });
    expect(fs.files.has('data/extra.json')).toBe(false);
    expect(doc.dirty).toBe(false);
  });

  it('rolls back a transaction that throws', async () => {
    const { doc, map } = await demo();
    expect(() =>
      doc.edit('Broken', (tx) => {
        tx.update('data/maps/map001.json', 'map', (m) => ({ ...m, name: 'Changed' }));
        tx.remove('nope.json');
      }),
    ).toThrow(/not part/);
    expect(map('map001').name).toBe('Meadow');
    expect(doc.canUndo).toBe(false);
  });

  it('refuses to create over an existing file', async () => {
    const { doc } = await demo();
    expect(() =>
      doc.edit('x', (tx) =>
        tx.create(
          'data/maps/map001.json',
          'map',
          'map001',
          newMapData('map001', {
            name: 'x',
            width: 1,
            height: 1,
            tileset: 'overworld',
          }),
        ),
      ),
    ).toThrow(/already exists/);
  });
});

describe('map operations', () => {
  it('creates a map listed in project.json, as one undo step', async () => {
    const { fs, doc, map, manifest } = await demo();
    expect(nextMapId(doc)).toBe('map002');
    const id = createMap(doc, {
      name: 'Cave',
      width: 6,
      height: 4,
      tileset: 'overworld',
      fillTile: 6,
    });
    expect(id).toBe('map002');
    expect(manifest().maps.at(-1)).toEqual({ id: 'map002', path: 'data/maps/map002.json' });
    const cave = map(id);
    expect(cave.layers.map((l) => l.name)).toEqual(['ground', 'upper']);
    expect(cave.layers[0]?.data).toEqual([0, 1, 2, 3].map(() => [6, 6, 6, 6, 6, 6]));
    expect(cave.layers[1]?.data[0]).toEqual(Array(6).fill(EMPTY_TILE));
    expect(doc.project.problems).toEqual([]);
    expect(doc.undoLabel).toBe('New map');

    await doc.save();
    // The saved project opens cleanly with the new map.
    const reopened = await openProject(fs);
    expect(reopened.problems).toEqual([]);
    expect(reopened.maps.get('map002')?.data?.name).toBe('Cave');

    doc.undo();
    expect(manifest().maps.map((m) => m.id)).toEqual(['map001', 'house']);
    expect(doc.project.maps.has('map002')).toBe(false);
  });

  it('rejects bad sizes and unknown tilesets', async () => {
    const { doc } = await demo();
    const base = { name: 'x', width: 5, height: 5, tileset: 'overworld' };
    expect(() => createMap(doc, { ...base, width: 0 })).toThrow(MapOperationError);
    expect(() => createMap(doc, { ...base, height: 1000 })).toThrow(MapOperationError);
    expect(() => createMap(doc, { ...base, width: 2.5 })).toThrow(MapOperationError);
    expect(() => createMap(doc, { ...base, tileset: 'nope' })).toThrow(/Unknown tileset/);
    expect(doc.canUndo).toBe(false);
  });

  it('duplicates a map with its events', async () => {
    const { doc, map } = await demo();
    const id = duplicateMap(doc, 'house');
    expect(map(id).name).toBe("Elder's house (copy)");
    expect(map(id).events).toEqual(map('house').events);
    expect(map(id).id).toBe(id);
    expect(doc.project.problems).toEqual([]);
  });

  it('deletes a map, warns about transfers into it, and protects the start map', async () => {
    const { fs, doc, manifest } = await demo();
    expect(mapUsages(doc.project, 'house')).toEqual(['Meadow › House door (page 1)']);
    expect(() => deleteMap(doc, 'map001')).toThrow(/start map/);
    deleteMap(doc, 'house');
    expect(manifest().maps.map((m) => m.id)).toEqual(['map001']);
    // The meadow's door now points nowhere: reported, not blocked.
    expect(doc.project.problems.some((p) => p.message.includes('"house"'))).toBe(true);
    const result = await doc.save();
    expect(result.written).toEqual(['project.json']);
    expect(result.removed).toEqual(['data/maps/house.json']);
    expect(fs.files.has('data/maps/house.json')).toBe(false);
  });
});

describe('resizing', () => {
  const small = (): GameMap => ({
    ...newMapData('m', { name: 'm', width: 2, height: 2, tileset: 't' }),
    layers: [
      {
        name: 'ground',
        data: [
          [1, 2],
          [3, 4],
        ],
      },
      {
        name: 'upper',
        data: [
          [5, -1],
          [-1, 6],
        ],
      },
    ],
    events: [
      { id: 'a', name: 'A', x: 0, y: 0, pages: [] },
      { id: 'b', name: 'B', x: 1, y: 1, pages: [] },
    ] as unknown as GameMap['events'],
  });

  it('grows from the top left, extending the ground with edge tiles', () => {
    const { map, dx, dy, droppedEvents } = resizeMap(small(), 3, 3, { x: 0, y: 0 });
    expect([dx, dy]).toEqual([0, 0]);
    expect(map.layers[0]?.data).toEqual([
      [1, 2, 2],
      [3, 4, 4],
      [3, 4, 4],
    ]);
    expect(map.layers[1]?.data).toEqual([
      [5, -1, -1],
      [-1, 6, -1],
      [-1, -1, -1],
    ]);
    expect(droppedEvents).toEqual([]);
  });

  it('moves content when anchored right/bottom and drops events that fall off', () => {
    const grown = resizeMap(small(), 4, 2, { x: 1, y: 0 });
    expect(grown.dx).toBe(2);
    expect(grown.map.layers[0]?.data).toEqual([
      [1, 1, 1, 2],
      [3, 3, 3, 4],
    ]);
    expect(grown.map.events.map((e) => [e.x, e.y])).toEqual([
      [2, 0],
      [3, 1],
    ]);

    const shrunk = resizeMap(small(), 1, 1, { x: 0, y: 0 });
    expect(shrunk.map.layers[0]?.data).toEqual([[1]]);
    expect(shrunk.droppedEvents.map((e) => e.id)).toEqual(['b']);
    expect(shrunk.map.events.map((e) => e.id)).toEqual(['a']);
  });

  it('keeps doors and the start position pointing at the same spot', async () => {
    const { doc, map, manifest } = await demo();
    // Add two columns on the left and one row on top of the house.
    applyResize(doc, 'house', 12, 8, { x: 1, y: 1 });
    const house = map('house');
    expect([house.width, house.height]).toEqual([12, 8]);
    expect(transfers(map('map001'))).toMatchObject([{ map: 'house', x: 6, y: 6 }]);
    expect(transfers(house)).toMatchObject([{ map: 'map001', x: 4, y: 5 }]); // unchanged target
    expect(manifest().start).toMatchObject({ map: 'map001', x: 7, y: 7 });
    expect(doc.project.problems).toEqual([]);

    applyResize(doc, 'map001', 22, 15, { x: 1, y: 0 });
    expect(manifest().start).toMatchObject({ x: 9, y: 7 });
    expect(transfers(map('house'))).toMatchObject([{ map: 'map001', x: 6, y: 5 }]);

    // Each resize is one undo step covering every file it touched.
    doc.undo();
    doc.undo();
    expect(doc.dirty).toBe(false);
  });
});
