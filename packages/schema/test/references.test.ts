import { describe, expect, it } from 'vitest';
import {
  type CharacterSheet,
  type Command,
  type GameMap,
  type Manifest,
  type ProjectData,
  type Tileset,
  checkMapShape,
  checkReferences,
} from '../src/index.js';

const manifest: Manifest = {
  formatVersion: 2,
  name: 'T',
  screen: { width: 32, height: 32 },
  start: { map: 'a', x: 0, y: 0, direction: 'down' },
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
    formatVersion: 2,
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

describe('checkMapShape events', () => {
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
