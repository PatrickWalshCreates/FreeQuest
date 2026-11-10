// Draws the editor's app icon (original pixel art: a pennant on a hill over a
// teal tile), 1024×1024. `pnpm --filter @freequest/editor gen:icon` writes it
// and runs `tauri icon` to make the desktop sizes in src-tauri/icons/.
import { execFileSync } from 'node:child_process';
import { readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const SIZE = 1024;
const GRID = 16; // pixel-art grid
const CELL = SIZE / GRID;

// 16×16 picture: . transparent, b background, h hill, H hill shade, p pole, f flag, F flag shade
const ART = [
  '..bbbbbbbbbbbb..',
  '.bbbbbbbbbbbbbb.',
  'bbbbbbbbbbbbbbbb',
  'bbbbbbpffffbbbbb',
  'bbbbbbpfffffFbbb',
  'bbbbbbpffffFbbbb',
  'bbbbbbpfffFbbbbb',
  'bbbbbbpbbbbbbbbb',
  'bbbbbbpbbbbbbbbb',
  'bbbbbbpbbbbbbbbb',
  'bbbbbhhhhbbbbbbb',
  'bbbhhhhhhhhbbbbb',
  'bbhhhhhhhhhhHbbb',
  'bhhhhhhhhhhhHHHb',
  '.HHHHHHHHHHHHHH.',
  '..HHHHHHHHHHHH..',
];

const COLORS: Record<string, [number, number, number]> = {
  b: [36, 92, 86],
  h: [120, 196, 110],
  H: [78, 150, 84],
  p: [236, 226, 206],
  f: [244, 196, 74],
  F: [214, 150, 52],
};

const png = new PNG({ width: SIZE, height: SIZE });
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const ch = ART[Math.floor(y / CELL)]?.[Math.floor(x / CELL)] ?? '.';
    const color = COLORS[ch];
    const i = (y * SIZE + x) * 4;
    png.data[i] = color?.[0] ?? 0;
    png.data[i + 1] = color?.[1] ?? 0;
    png.data[i + 2] = color?.[2] ?? 0;
    png.data[i + 3] = color ? 255 : 0;
  }
}

const source = fileURLToPath(new URL('../src-tauri/icons/icon-source.png', import.meta.url));
writeFileSync(source, PNG.sync.write(png));
execFileSync('pnpm', ['tauri', 'icon', source], { stdio: 'inherit' });

// Keep only the desktop icons that tauri.conf.json lists (mobile and store icons come with M7).
const KEEP = new Set([
  'icon-source.png',
  'icon.png',
  'icon.icns',
  'icon.ico',
  '32x32.png',
  '128x128.png',
  '128x128@2x.png',
]);
const dir = fileURLToPath(new URL('../src-tauri/icons/', import.meta.url));
for (const name of readdirSync(dir)) {
  if (!KEEP.has(name)) rmSync(dir + name, { recursive: true });
}
