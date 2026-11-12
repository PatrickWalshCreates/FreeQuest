// Builds templates/starter from the demo's original assets: the smallest
// project that plays (one map with a welcome sign, a hero, basic skills, a
// potion, one enemy) for "New project". Deterministic: run it again after
// changing the demo's assets or formats (`pnpm gen:templates`).
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMPTY_TILE,
  type GameMap,
  MAP_FORMAT_VERSION,
  type Manifest,
  stableStringify,
} from '../packages/schema/src/index.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DEMO = join(ROOT, 'samples', 'demo-project');
const OUT = join(ROOT, 'templates', 'starter');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(join(DEMO, path), 'utf8')) as T;
const write = (path: string, data: unknown) => {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  writeFileSync(join(OUT, path), stableStringify(data));
};
const copy = (path: string) => {
  mkdirSync(dirname(join(OUT, path)), { recursive: true });
  cpSync(join(DEMO, path), join(OUT, path), { recursive: true });
};

interface Entries<T> {
  formatVersion: number;
  entries: T[];
}
type Entry = { id: string } & Record<string, unknown>;
const keep = (file: string, ids: string[], change: (e: Entry) => Entry = (e) => e) => {
  const data = readJson<Entries<Entry>>(`data/database/${file}.json`);
  write(`data/database/${file}.json`, {
    ...data,
    entries: data.entries.filter((e) => ids.includes(e.id)).map(change),
  });
};

rmSync(OUT, { recursive: true, force: true });

// Assets: the overworld tiles, the hero, a villager, the slime, icons, and all the (small) audio.
copy('assets/tilesets/overworld.png');
copy('assets/characters/hero.png');
copy('assets/characters/villager.png');
copy('assets/enemies/slime.png');
copy('assets/system/iconset.png');
copy('assets/audio');
copy('data/tilesets/overworld.json');
copy('data/characters/hero.json');
copy('data/characters/villager.json');

// Tile indices in the overworld tileset.
const GRASS = 0;
const FLOWERS = 1;
const DIRT = 2;
const TRUNK = 10;
const CANOPY = 11;
const BUSH = 13;
const SIGN = 15;

const W = 17;
const H = 13;
const ground = Array.from({ length: H }, (_, y) =>
  Array.from({ length: W }, (_, x) => {
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) return BUSH;
    if (y === 7 && x > 1 && x < W - 2) return DIRT;
    return (x * 7 + y * 3) % 11 === 0 ? FLOWERS : GRASS;
  }),
);
const upper = ground.map((row) => row.map(() => EMPTY_TILE));
for (const [x, y] of [
  [3, 3],
  [13, 4],
  [4, 10],
  [12, 10],
] as const) {
  const below = ground[y];
  const above = upper[y - 1];
  if (below) below[x] = TRUNK;
  if (above) above[x] = CANOPY;
}
const signRow = ground[5];
if (signRow) signRow[8] = SIGN;

const map: GameMap = {
  formatVersion: MAP_FORMAT_VERSION,
  id: 'map001',
  name: 'First map',
  width: W,
  height: H,
  tileset: 'overworld',
  music: 'assets/audio/meadow.wav',
  layers: [
    { name: 'ground', data: ground },
    { name: 'upper', data: upper },
  ],
  events: [
    {
      id: 'sign',
      name: 'Welcome sign',
      x: 8,
      y: 5,
      pages: [
        {
          conditions: [],
          trigger: 'action',
          layer: 'same',
          commands: [
            {
              type: 'message',
              text: 'Welcome to your new game, {color:yellow}{member:1}{/color}!',
            },
            {
              type: 'message',
              text: 'Open it in the FreeQuest editor to change this map, this sign, and everything else.',
            },
          ],
        },
      ],
    },
    {
      id: 'shopkeeper',
      name: 'Shopkeeper',
      x: 11,
      y: 8,
      pages: [
        {
          conditions: [],
          trigger: 'action',
          layer: 'same',
          graphic: { character: 'villager', direction: 'left' },
          commands: [
            { type: 'message', speaker: 'Shopkeeper', text: 'Supplies for the road?' },
            {
              type: 'shop',
              canSell: true,
              goods: [
                { kind: 'item', id: 'potion' },
                { kind: 'equipment', id: 'bronze-sword' },
                { kind: 'equipment', id: 'leather-vest' },
              ],
            },
            { type: 'message', speaker: 'Shopkeeper', text: 'Come back any time.' },
          ],
        },
      ],
    },
  ],
};
write('data/maps/map001.json', map);

// Database: just enough to play, fight and grow from.
copy('data/database/system.json');
keep('actors', ['hero'], (e) => ({
  ...e,
  equipment: { weapon: 'bronze-sword', body: 'leather-vest' },
}));
keep('classes', ['warrior'], (e) => ({ ...e, skills: [] }));
keep('skills', ['attack', 'guard']);
keep('items', ['potion']);
keep('equipment', ['bronze-sword', 'leather-vest']);
keep('states', ['knockout', 'guarding']);
keep('enemies', ['slime'], (e) => ({
  ...e,
  drops: ((e['drops'] as { id: string }[] | undefined) ?? []).filter((d) => d.id === 'potion'),
}));
keep('troops', ['slimes']);
// A shared "rest" any event can call (an inn, a bed), as an example of common events.
keep('commonEvents', ['rest']);

const demo = readJson<Manifest>('project.json');
const manifest: Manifest = {
  ...demo,
  id: 'my-game',
  name: 'My Game',
  tilesets: [{ id: 'overworld', path: 'data/tilesets/overworld.json' }],
  characters: [
    { id: 'hero', path: 'data/characters/hero.json' },
    { id: 'villager', path: 'data/characters/villager.json' },
  ],
  maps: [{ id: 'map001', path: 'data/maps/map001.json' }],
  switches: [],
  variables: [],
  start: { map: 'map001', x: 8, y: 8, direction: 'up', party: ['hero'], gold: 100 },
};
write('project.json', manifest);

// What the New project dialog says about it (not part of the project).
writeFileSync(
  join(OUT, 'template.json'),
  `${JSON.stringify(
    {
      name: 'Starter',
      description:
        'One small map with a sign, a shopkeeper, a hero, basic skills and a potion. Ready to play and grow.',
    },
    null,
    2,
  )}\n`,
);
console.log(`Wrote ${OUT}`);
