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
    autoplayBgm: false,
    bgm: { name: '', pan: 0, pitch: 100, volume: 90 },
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
    events: [null],
  }),
);
