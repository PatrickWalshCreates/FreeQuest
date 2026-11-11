import { describe, expect, it } from 'vitest';
import {
  type CharacterSheet,
  type Command,
  type Database,
  type GameMap,
  type Manifest,
  type ProjectData,
  type Tileset,
  checkManifestReferences,
  checkCharacterShape,
  checkMapReferences,
  checkMapShape,
  checkReferences,
  emptyDatabase,
} from '../src/index.js';

const manifest: Manifest = {
  formatVersion: 5,
  id: 'test-game',
  name: 'T',
  screen: { width: 32, height: 32 },
  start: { map: 'a', x: 0, y: 0, direction: 'down', party: [], gold: 0 },
  player: { character: 'hero', speed: 4 },
  tilesets: [],
  maps: [],
  characters: [],
  switches: [{ id: 'flag', name: 'Flag' }],
  variables: [{ id: 'count', name: 'Count' }],
};

const tileset: Tileset = {
  formatVersion: 1,
  id: 'ts',
  name: 'TS',
  image: 'ts.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: 1,
  tiles: [{ passable: true }],
};

const hero = { id: 'hero' } as CharacterSheet;

function mapWith(commands: Command[], extra: Partial<GameMap> = {}): GameMap {
  return {
    formatVersion: 6,
    id: 'a',
    name: 'A',
    width: 2,
    height: 2,
    tileset: 'ts',
    layers: [
      {
        name: 'g',
        data: [
          [0, 0],
          [0, 0],
        ],
      },
    ],
    events: [
      {
        id: 'e',
        name: 'E',
        x: 0,
        y: 0,
        pages: [{ conditions: [], trigger: 'action', layer: 'same', commands }],
      },
    ],
    ...extra,
  };
}

function project(map: GameMap, m: Manifest = manifest): ProjectData {
  return {
    manifest: m,
    tilesets: new Map([['ts', tileset]]),
    maps: new Map([[map.id, map]]),
    characters: new Map([['hero', hero]]),
  };
}

describe('checkReferences', () => {
  it('accepts a project whose references all resolve', () => {
    const map = mapWith([
      { type: 'setSwitch', switch: 'flag', value: true },
      { type: 'setVariable', variable: 'count', op: 'add', value: { variable: 'count' } },
      { type: 'transfer', map: 'a', x: 1, y: 1 },
    ]);
    expect(checkReferences(project(map))).toEqual([]);
  });

  it('finds undeclared flags, including inside nested blocks', () => {
    const map = mapWith([
      {
        type: 'choice',
        options: [
          {
            label: 'x',
            commands: [
              {
                type: 'if',
                conditions: [{ type: 'switch', switch: 'nope', value: true }],
                then: [],
                else: [{ type: 'setVariable', variable: 'missing', op: 'set', value: 1 }],
              },
            ],
          },
        ],
      },
    ]);
    const problems = checkReferences(project(map));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/options\[0\]\.commands\[0\]: undeclared switch "nope"/);
    expect(problems[1]).toMatch(/\.else\[0\]: undeclared variable "missing"/);
  });

  it('checks transfer targets exist and are in bounds', () => {
    const map = mapWith([
      { type: 'transfer', map: 'nowhere', x: 0, y: 0 },
      { type: 'transfer', map: 'a', x: 5, y: 0 },
    ]);
    const problems = checkReferences(project(map));
    expect(problems).toEqual([
      expect.stringMatching(/unknown map "nowhere"/),
      expect.stringMatching(/\(5, 0\) is outside map "a"/),
    ]);
  });

  it('checks tilesets, characters and duplicate declarations', () => {
    const map = mapWith([], { tileset: 'gone' });
    const page = map.events[0]?.pages[0];
    if (!page) throw new Error('fixture');
    page.graphic = { character: 'ghost', direction: 'down' };
    const m = { ...manifest, switches: [...manifest.switches, { id: 'flag', name: 'Again' }] };
    const problems = checkReferences(project(map, m));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/duplicate switch "flag"/),
        expect.stringMatching(/unknown tileset "gone"/),
        expect.stringMatching(/unknown character "ghost"/),
      ]),
    );
  });
});

describe('checkCharacterShape', () => {
  it('flags frames past the end of the sheet', () => {
    const sheet = {
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
    } satisfies CharacterSheet;
    expect(checkCharacterShape(sheet)).toEqual([]);
    expect(checkCharacterShape({ ...sheet, idleFrame: 3, walkCycle: [0, 4, 5, 4] })).toEqual([
      'standing frame 3 is past the last frame (2)',
      'walk cycle uses frames 4, 5, past the last frame (2)',
    ]);
  });
});

describe('map tiles', () => {
  it('flags tiles the tileset does not have', () => {
    const map = mapWith([]);
    const ctx = {
      manifest,
      tilesets: new Map([['ts', tileset]]),
      characters: new Map([['hero', hero]]),
      maps: new Map([['a', map]]),
    };
    expect(checkMapReferences(map, ctx)).toEqual([]);
    const row = map.layers[0]?.data[1];
    if (!row) throw new Error('fixture');
    row[1] = 3;
    expect(checkMapReferences(map, ctx)).toEqual([
      'map "a" layer "g": uses tile 3, but tileset "ts" has only 1 tile',
    ]);
  });
});

describe('checkMapShape events', () => {
  it('rejects move routes that wait forever or move nobody', () => {
    const route = (target: string, repeat: boolean, wait: boolean): Command => ({
      type: 'moveRoute',
      target,
      steps: [{ type: 'move', direction: 'up' }],
      repeat,
      skipBlocked: false,
      wait,
    });
    expect(
      checkMapShape(mapWith([route('this', false, true), route('player', true, false)])),
    ).toEqual([]);
    expect(checkMapShape(mapWith([route('ghost', true, true)]))).toEqual([
      expect.stringMatching(/repeating route never ends/),
      expect.stringMatching(/route for "ghost", which isn't an event on this map/),
    ]);
  });

  it('rejects duplicate ids, out-of-bounds events and bad cancel indices', () => {
    const map = mapWith([{ type: 'choice', cancel: 3, options: [{ label: 'a', commands: [] }] }]);
    const first = map.events[0];
    if (!first) throw new Error('fixture');
    map.events.push({ ...first, x: 9 });
    const problems = checkMapShape(map);
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/duplicate event id/),
        expect.stringMatching(/outside the map/),
        expect.stringMatching(/cancel index 3 has no option/),
      ]),
    );
  });
});

describe('lazy map checks', () => {
  it('accepts transfers to listed maps that are not loaded yet', () => {
    const map = mapWith([{ type: 'transfer', map: 'b', x: 99, y: 99 }]);
    const m = { ...manifest, maps: [{ id: 'b', path: 'data/maps/b.json' }] };
    const ctx = {
      manifest: m,
      tilesets: new Map([['ts', tileset]]),
      characters: new Map([['hero', hero]]),
    };
    expect(checkMapReferences(map, ctx)).toEqual([]);
  });

  it('bounds-checks transfer targets once their map is loaded', () => {
    const map = mapWith([{ type: 'transfer', map: 'a', x: 99, y: 0 }]);
    const ctx = {
      manifest,
      tilesets: new Map([['ts', tileset]]),
      characters: new Map([['hero', hero]]),
      maps: new Map([['a', map]]),
    };
    expect(checkMapReferences(map, ctx)).toEqual([expect.stringMatching(/outside map "a"/)]);
  });

  it('flags a start map missing from the manifest', () => {
    const ctx = { manifest, tilesets: new Map(), characters: new Map([['hero', hero]]) };
    expect(checkManifestReferences(ctx)).toEqual([expect.stringMatching(/unknown map "a"/)]);
  });
});

describe('database-aware event checks', () => {
  it('flags unknown items and actors used by events when the database is given', () => {
    const database = {
      ...emptyDatabase(),
      items: [{ id: 'potion' }],
      actors: [{ id: 'hero' }],
    } as unknown as Database;
    const map = mapWith([
      { type: 'changeItems', kind: 'item', id: 'potion', amount: 1 },
      { type: 'changeItems', kind: 'item', id: 'elixir', amount: 1 },
      { type: 'changeParty', action: 'add', actor: 'ghost' },
      { type: 'changeGold', amount: { variable: 'count' } },
      {
        type: 'if',
        conditions: [
          { type: 'hasItem', kind: 'equipment', id: 'potion' },
          { type: 'inParty', actor: 'hero' },
        ],
        then: [],
      },
    ]);
    const ctx = {
      manifest,
      tilesets: new Map([['ts', tileset]]),
      characters: new Map([['hero', hero]]),
      database,
    };
    expect(checkMapReferences(map, ctx)).toEqual([
      expect.stringMatching(/commands\[1\]: unknown item "elixir"/),
      expect.stringMatching(/commands\[2\]: unknown actor "ghost"/),
      expect.stringMatching(/commands\[4\]: unknown equipment "potion"/),
    ]);
  });
});

describe('battle references', () => {
  it('checks troops used by battle commands and encounters, including nested branches', () => {
    const database = { ...emptyDatabase(), troops: [{ id: 'slimes' }] } as unknown as Database;
    const map = mapWith(
      [
        {
          type: 'battle',
          troop: 'slimes',
          canEscape: true,
          canLose: false,
          onWin: [{ type: 'battle', troop: 'dragons', canEscape: false, canLose: false }],
        },
      ],
      { encounters: { steps: 30, troops: [{ troop: 'ghosts', weight: 1 }] } },
    );
    const ctx = {
      manifest,
      tilesets: new Map([['ts', tileset]]),
      characters: new Map([['hero', hero]]),
      database,
    };
    expect(checkMapReferences(map, ctx)).toEqual([
      expect.stringMatching(/encounters\.troops\[0\]: unknown troop "ghosts"/),
      expect.stringMatching(/onWin\[0\]: unknown troop "dragons"/),
    ]);
  });
});
