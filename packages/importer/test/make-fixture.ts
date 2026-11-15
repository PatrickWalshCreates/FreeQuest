// Run with: npx tsx packages/importer/test/make-fixture.ts packages/importer/test/fixtures/tiny-mz
// Writes the tiny-mz fixture's tileset, map and synthetic sheets (our own art:
// every quarter tile a colour that says where it is: R = column, G = row, B = sheet).
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
const root = process.argv[2] ?? 'packages/importer/test/fixtures/tiny-mz';
const sheet = (name: string, tilesW: number, tilesH: number, b: number) => {
  const q = 24,
    png = new PNG({ width: tilesW * 48, height: tilesH * 48 });
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = Math.floor(x / q) * 8;
      png.data[i + 1] = Math.floor(y / q) * 8;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  mkdirSync(join(root, 'img', 'tilesets'), { recursive: true });
  writeFileSync(join(root, 'img', 'tilesets', name + '.png'), PNG.sync.write(png));
};
// Characters: an 8-character sheet (12 × 8 frames of 48 px) and a "$" sheet of one (3 × 4).
const frames = (
  name: string,
  folder: string,
  cols: number,
  rows: number,
  size: number,
  b: number,
) => {
  const png = new PNG({ width: cols * size, height: rows * size });
  for (let y = 0; y < png.height; y++)
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = Math.floor(x / size) * 16;
      png.data[i + 1] = Math.floor(y / size) * 16;
      png.data[i + 2] = b;
      png.data[i + 3] = 255;
    }
  mkdirSync(join(root, 'img', folder), { recursive: true });
  writeFileSync(join(root, 'img', folder, name + '.png'), PNG.sync.write(png));
};
frames('Lamplighters', 'characters', 12, 8, 48, 10);
frames('$Tamsin', 'characters', 3, 4, 48, 11);
frames('Lamplighters_face', 'faces', 4, 2, 144, 12);
frames('Moth', 'enemies', 1, 1, 64, 13);
frames('IconSet', 'system', 16, 2, 32, 14);
sheet('Hollow_A1', 2, 3, 1);
sheet('Hollow_A2', 2, 3, 2);
sheet('Hollow_B', 5, 1, 5);
const flags = new Array(8192).fill(0);
const A1 = 2048,
  A2 = 2816;
for (let s = 0; s < 48; s++) flags[A1 + s] = 0x0f; // water: blocked
flags[1] = 0; // bridge
flags[2] = 0x10; // treetop: above
flags[3] = 0x0f; // rock
flags[4] = 0x01; // fence: blocked going down only
flags[0] = 0x10;
writeFileSync(
  join(root, 'data', 'Tilesets.json'),
  JSON.stringify([
    null,
    {
      id: 1,
      flags,
      mode: 0,
      name: 'Hollow',
      note: '',
      tilesetNames: ['Hollow_A1', 'Hollow_A2', '', '', '', 'Hollow_B', '', '', ''],
    },
  ]),
);
const w = 4,
  h = 3,
  data = new Array(w * h * 6).fill(0);
const set = (x: number, y: number, z: number, id: number) => {
  data[(z * h + y) * w + x] = id;
};
// Ground: grass (A2 kind 0) everywhere but the water cells and one empty cell.
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 0, A2 + 0);
set(0, 0, 0, A2 + 46);
set(1, 0, 0, A1 + 0);
set(2, 0, 0, A1 + 0);
set(2, 1, 0, A1 + 0);
set(3, 1, 0, 0);
set(2, 0, 2, 1); // bridge over water
set(3, 0, 2, 2); // treetop
set(0, 1, 2, 3); // rock
set(1, 1, 2, 4); // fence
set(0, 2, 4, 5); // a shadow
set(1, 2, 5, 3); // a region
writeFileSync(
  join(root, 'data', 'Map001.json'),
  JSON.stringify({
    autoplayBgm: true,
    autoplayBgs: true,
    bgs: { name: 'Wind', pan: 0, pitch: 100, volume: 90 },
    bgm: { name: 'Hollow', pan: 0, pitch: 100, volume: 90 },
    displayName: 'The Hollow',
    encounterList: [
      { regionSet: [3], troopId: 1, weight: 10 },
      { regionSet: [], troopId: 9, weight: 5 },
    ],
    encounterStep: 25,
    height: h,
    note: '',
    tilesetId: 1,
    width: w,
    data,
    events: [null, keeper(), gate(), stagehand()],
  }),
);

// Events: commands are MZ's flat list with indents.
function cmd(code: number, indent: number, parameters: unknown[] = []) {
  return { code, indent, parameters };
}
function page(overrides: Record<string, unknown>) {
  return {
    conditions: {
      actorId: 1,
      actorValid: false,
      itemId: 1,
      itemValid: false,
      selfSwitchCh: 'A',
      selfSwitchValid: false,
      switch1Id: 1,
      switch1Valid: false,
      switch2Id: 1,
      switch2Valid: false,
      variableId: 1,
      variableValid: false,
      variableValue: 0,
    },
    directionFix: false,
    image: { characterIndex: 0, characterName: '', direction: 2, pattern: 1, tileId: 0 },
    list: [cmd(0, 0)],
    moveFrequency: 3,
    moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
    moveSpeed: 3,
    moveType: 0,
    priorityType: 1,
    stepAnime: false,
    through: false,
    trigger: 0,
    walkAnime: true,
    ...overrides,
  };
}
function keeper() {
  const list = [
    cmd(101, 0, ['Lamplighters_face', 2, 0, 2, 'Keeper']),
    cmd(401, 0, ['Hello \\N[1]! You lit \\V[1] lanterns.']),
    cmd(401, 0, ['\\C[2]Careful\\C[0] \\.out there {friend}.']),
    cmd(102, 0, [['Yes', 'No'], 1, 0, 2, 0]),
    cmd(402, 0, [0, 'Yes']),
    cmd(121, 1, [1, 1, 0]),
    cmd(123, 1, ['A', 0]),
    cmd(0, 1),
    cmd(402, 0, [1, 'No']),
    cmd(0, 1),
    cmd(404, 0),
    cmd(111, 0, [0, 1, 0]),
    cmd(125, 1, [0, 0, 50]),
    cmd(0, 1),
    cmd(411, 0),
    cmd(355, 1, ['console.log(1)']),
    cmd(0, 1),
    cmd(412, 0),
    cmd(111, 0, [12, 'true']),
    cmd(230, 1, [60]),
    cmd(0, 1),
    cmd(412, 0),
    cmd(112, 0),
    cmd(122, 1, [1, 1, 1, 0, 2]),
    cmd(113, 1),
    cmd(0, 1),
    cmd(413, 0),
    cmd(201, 0, [0, 1, 3, 2, 8, 0]),
    cmd(301, 0, [0, 2, true, false]),
    cmd(601, 0),
    cmd(101, 1, ['', 0, 0, 2, '']),
    cmd(401, 1, ['Well fought.']),
    cmd(0, 1),
    cmd(602, 0),
    cmd(0, 1),
    cmd(604, 0),
    cmd(302, 0, [0, 1, 1, 30, false]),
    cmd(605, 0, [1, 1, 0, 0]),
    cmd(250, 0, [{ name: 'Chime', pan: 0, pitch: 100, volume: 90 }]),
    cmd(213, 0, [-1, 1, false]),
    cmd(117, 0, [1]),
    cmd(322, 0, [2, 'Lamplighters', 3, '', 0, '']),
    cmd(320, 0, [1, 'Wren the Bright']),
    cmd(211, 0, [0]),
    cmd(0, 0),
  ];
  return {
    id: 1,
    name: 'Keeper',
    note: '',
    x: 1,
    y: 2,
    pages: [
      page({
        image: {
          characterIndex: 1,
          characterName: 'Lamplighters',
          direction: 4,
          pattern: 1,
          tileId: 0,
        },
        list,
      }),
      page({
        conditions: {
          ...(page({}).conditions as object),
          selfSwitchValid: true,
          selfSwitchCh: 'A',
        },
        image: { characterIndex: 0, characterName: '', direction: 2, pattern: 0, tileId: 3 },
        list: [
          cmd(205, 0, [
            0,
            {
              list: [
                { code: 4, parameters: [] },
                { code: 14, parameters: [0, 0] },
                { code: 15, parameters: [30] },
                { code: 41, parameters: ['', 0] },
                { code: 41, parameters: ['Lamplighters', 1] },
                { code: 0, parameters: [] },
              ],
              repeat: false,
              skippable: true,
              wait: true,
            },
          ]),
          cmd(505, 0, [{ code: 4, parameters: [] }]),
          cmd(214, 0),
          cmd(0, 0),
        ],
      }),
    ],
  };
}
/** Commands M14 step 4 brings across: game data, branch tests, placing, scrolling, audio, HP. */
function stagehand() {
  const branch = (params: unknown[]) => [cmd(111, 0, params), cmd(0, 1), cmd(412, 0)];
  const list = [
    cmd(122, 0, [1, 1, 0, 2, 1, 6]),
    cmd(122, 0, [1, 1, 0, 3, 7, 2, 0]),
    cmd(122, 0, [1, 1, 1, 3, 3, 1, 2]),
    cmd(122, 0, [1, 1, 0, 3, 5, -1, 0]),
    cmd(122, 0, [1, 1, 0, 4, '1 + 1']),
    ...branch([4, 1, 6, 2]),
    ...branch([4, 2, 1, 'Tam']),
    ...branch([6, -1, 8]),
    ...branch([11, 'ok', 0]),
    ...branch([11, 'shift', 0]),
    cmd(203, 0, [0, 0, 2, 1, 4]),
    cmd(203, 0, [1, 1, 1, 1, 0]),
    cmd(204, 0, [6, 3, 4, true]),
    cmd(245, 0, [{ name: 'Wind', pan: 0, pitch: 100, volume: 90 }]),
    cmd(246, 0, [10]),
    cmd(132, 0, [{ name: 'Hollow', pan: 0, pitch: 100, volume: 90 }]),
    cmd(133, 0, [{ name: '', pan: 0, pitch: 100, volume: 90 }]),
    cmd(134, 0, [0]),
    cmd(135, 0, [1]),
    cmd(311, 0, [0, 0, 1, 0, 10, false]),
    cmd(312, 0, [0, 1, 0, 0, 5]),
    cmd(313, 0, [0, 1, 0, 2]),
    cmd(352, 0),
    cmd(353, 0),
    cmd(354, 0),
    cmd(0, 0),
  ];
  // Only there once 999 lanterns are lit (never, in the tests that play the map).
  const conditions = {
    ...(page({}).conditions as object),
    variableValid: true,
    variableValue: 999,
  };
  return { id: 3, name: 'Stagehand', note: '', x: 2, y: 2, pages: [page({ conditions, list })] };
}
function gate() {
  return {
    id: 2,
    name: 'Gate',
    note: '',
    x: 3,
    y: 1,
    pages: [
      page({
        image: { characterIndex: 0, characterName: '$Tamsin', direction: 8, pattern: 1, tileId: 0 },
        moveType: 1,
        moveSpeed: 4,
        moveFrequency: 3,
        priorityType: 0,
        trigger: 1,
        directionFix: true,
      }),
    ],
  };
}
writeFileSync(
  join(root, 'data', 'CommonEvents.json'),
  JSON.stringify([
    null,
    {
      id: 1,
      list: [cmd(121, 0, [3, 3, 0]), cmd(0, 0)],
      name: 'Open gate',
      switchId: 1,
      trigger: 0,
    },
    { id: 2, list: [cmd(0, 0)], name: '', switchId: 1, trigger: 0 },
    {
      id: 3,
      list: [cmd(223, 0, [[-68, -68, 0, 68], 60, true]), cmd(0, 0)],
      name: 'Night',
      switchId: 3,
      trigger: 2,
    },
  ]),
);
// A window skin: only the text colour squares matter (colour 2 is red here).
{
  const png = new PNG({ width: 192, height: 192 });
  png.data.fill(0);
  for (let y = 0; y < 12; y++)
    for (let x = 0; x < 12; x++) {
      const i = ((144 + y) * 192 + 96 + 2 * 12 + x) * 4;
      png.data[i] = 0xff;
      png.data[i + 1] = 0x30;
      png.data[i + 2] = 0x30;
      png.data[i + 3] = 255;
    }
  mkdirSync(join(root, 'img', 'system'), { recursive: true });
  writeFileSync(join(root, 'img', 'system', 'Window.png'), PNG.sync.write(png));
}
mkdirSync(join(root, 'audio', 'se'), { recursive: true });
writeFileSync(join(root, 'audio', 'se', 'Chime.ogg'), 'OggS fake sound for tests');
mkdirSync(join(root, 'audio', 'bgm'), { recursive: true });
mkdirSync(join(root, 'audio', 'me'), { recursive: true });
mkdirSync(join(root, 'audio', 'bgs'), { recursive: true });
writeFileSync(join(root, 'audio', 'bgs', 'Wind.ogg'), 'OggS wind');
writeFileSync(join(root, 'audio', 'se', 'Cursor.ogg'), 'OggS cursor');
writeFileSync(join(root, 'audio', 'bgm', 'Hollow.ogg'), 'OggS hollow');
writeFileSync(join(root, 'audio', 'bgm', 'Title.ogg'), 'OggS title');
writeFileSync(join(root, 'audio', 'me', 'Victory.m4a'), 'not ogg');
