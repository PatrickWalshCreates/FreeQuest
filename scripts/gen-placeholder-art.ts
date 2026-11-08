// Generates FreeQuest's original placeholder art for the demo project:
//   assets/tilesets/overworld.png  4x4 grid of 32px tiles
//   assets/characters/<name>.png   3 frames x 4 directions, 32px frames
//   assets/enemies/<id>.png        64x64 battle art
// Output is deterministic, so re-running produces byte-identical files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'samples', 'demo-project');
const T = 32;

type RGBA = [number, number, number, number];

function hex(color: string, alpha = 255): RGBA {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

class Canvas {
  readonly png: PNG;
  constructor(width: number, height: number) {
    this.png = new PNG({ width, height });
    this.png.data.fill(0);
  }
  set(x: number, y: number, c: RGBA): void {
    if (x < 0 || y < 0 || x >= this.png.width || y >= this.png.height) return;
    const i = (y * this.png.width + x) * 4;
    this.png.data[i] = c[0];
    this.png.data[i + 1] = c[1];
    this.png.data[i + 2] = c[2];
    this.png.data[i + 3] = c[3];
  }
  rect(x: number, y: number, w: number, h: number, c: RGBA): void {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }
  circle(cx: number, cy: number, r: number, c: RGBA): void {
    for (let j = -r; j <= r; j++)
      for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r) this.set(cx + i, cy + j, c);
  }
  save(path: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, PNG.sync.write(this.png));
    console.log(`wrote ${path}`);
  }
}

/** Deterministic per-pixel noise in [0, 1). */
function noise(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function speckle(
  c: Canvas,
  ox: number,
  oy: number,
  base: RGBA,
  dots: RGBA,
  density: number,
  seed: number,
): void {
  for (let y = 0; y < T; y++)
    for (let x = 0; x < T; x++) c.set(ox + x, oy + y, noise(x, y, seed) < density ? dots : base);
}

type TileDrawer = (c: Canvas, ox: number, oy: number) => void;

const grass: TileDrawer = (c, ox, oy) =>
  speckle(c, ox, oy, hex('#5aa846'), hex('#4b9139'), 0.12, 1);

// Index order must match samples/demo-project/data/tilesets/overworld.json.
const TILES: TileDrawer[] = [
  // 0 grass
  grass,
  // 1 flowers
  (c, ox, oy) => {
    grass(c, ox, oy);
    for (const [x, y, col] of [
      [7, 8, '#f2e14c'],
      [22, 6, '#f07aa6'],
      [12, 22, '#ffffff'],
      [25, 20, '#f2e14c'],
    ] as const) {
      c.circle(ox + x, oy + y, 1, hex(col));
    }
  },
  // 2 dirt path
  (c, ox, oy) => speckle(c, ox, oy, hex('#b8925a'), hex('#a27d49'), 0.15, 2),
  // 3 sand
  (c, ox, oy) => speckle(c, ox, oy, hex('#e6d39a'), hex('#d4bf82'), 0.1, 3),
  // 4 shallow water
  (c, ox, oy) => {
    speckle(c, ox, oy, hex('#4a90d9'), hex('#5ea2e6'), 0.08, 4);
    c.rect(ox + 6, oy + 10, 8, 1, hex('#a8d4ff'));
    c.rect(ox + 18, oy + 22, 8, 1, hex('#a8d4ff'));
  },
  // 5 deep water
  (c, ox, oy) => {
    speckle(c, ox, oy, hex('#2c5fa8'), hex('#3a6fba'), 0.08, 5);
    c.rect(ox + 12, oy + 14, 8, 1, hex('#6f9fe0'));
  },
  // 6 stone floor
  (c, ox, oy) => {
    c.rect(ox, oy, T, T, hex('#9a9a9a'));
    for (let i = 0; i < T; i += 16) {
      c.rect(ox, oy + i, T, 1, hex('#7a7a7a'));
      c.rect(ox + i, oy, 1, T, hex('#7a7a7a'));
    }
  },
  // 7 wood floor
  (c, ox, oy) => {
    c.rect(ox, oy, T, T, hex('#a0683a'));
    for (let y = 0; y < T; y += 8) c.rect(ox, oy + y, T, 1, hex('#7f5029'));
  },
  // 8 brick wall
  (c, ox, oy) => {
    c.rect(ox, oy, T, T, hex('#a4483c'));
    for (let row = 0; row < 4; row++) {
      c.rect(ox, oy + row * 8, T, 1, hex('#6e2e26'));
      const shift = row % 2 === 0 ? 0 : 8;
      for (let x = shift; x < T; x += 16) c.rect(ox + x, oy + row * 8, 1, 8, hex('#6e2e26'));
    }
  },
  // 9 roof
  (c, ox, oy) => {
    c.rect(ox, oy, T, T, hex('#4a4f7a'));
    for (let y = 3; y < T; y += 6) c.rect(ox, oy + y, T, 2, hex('#383c5e'));
  },
  // 10 tree trunk (grass base)
  (c, ox, oy) => {
    grass(c, ox, oy);
    c.rect(ox + 12, oy, 8, 22, hex('#6b4423'));
    c.rect(ox + 10, oy + 20, 12, 4, hex('#3d7a2e'));
  },
  // 11 tree canopy (drawn above characters, transparent around)
  (c, ox, oy) => {
    c.circle(ox + 16, oy + 16, 14, hex('#2f7a33'));
    c.circle(ox + 11, oy + 11, 5, hex('#3f9443'));
    c.circle(ox + 21, oy + 18, 4, hex('#286b2c'));
  },
  // 12 rock
  (c, ox, oy) => {
    grass(c, ox, oy);
    c.circle(ox + 16, oy + 18, 10, hex('#7d7d86'));
    c.circle(ox + 13, oy + 15, 4, hex('#9b9ba5'));
  },
  // 13 bush
  (c, ox, oy) => {
    grass(c, ox, oy);
    c.circle(ox + 16, oy + 18, 11, hex('#3a8a3a'));
    c.circle(ox + 12, oy + 14, 4, hex('#52a852'));
  },
  // 14 wooden bridge
  (c, ox, oy) => {
    c.rect(ox, oy, T, T, hex('#8a5a30'));
    for (let x = 0; x < T; x += 8) c.rect(ox + x, oy, 1, T, hex('#5e3c1e'));
    c.rect(ox, oy, T, 2, hex('#5e3c1e'));
    c.rect(ox, oy + T - 2, T, 2, hex('#5e3c1e'));
  },
  // 15 signpost
  (c, ox, oy) => {
    grass(c, ox, oy);
    c.rect(ox + 15, oy + 14, 3, 14, hex('#6b4423'));
    c.rect(ox + 6, oy + 6, 20, 10, hex('#c49a5c'));
    c.rect(ox + 9, oy + 9, 14, 1, hex('#6b4423'));
    c.rect(ox + 9, oy + 12, 10, 1, hex('#6b4423'));
  },
];

function drawTileset(): void {
  const c = new Canvas(T * 4, T * 4);
  TILES.forEach((draw, i) => draw(c, (i % 4) * T, Math.floor(i / 4) * T));
  c.save(join(ROOT, 'assets', 'tilesets', 'overworld.png'));
}

const ROWS = ['down', 'left', 'right', 'up'] as const;

interface CharacterPalette {
  skin: string;
  hair: string;
  tunic: string;
  belt: string;
  legs: string;
}

const CHARACTERS: Record<string, CharacterPalette> = {
  hero: { skin: '#f0c8a0', hair: '#3b2a1e', tunic: '#2f6fb5', belt: '#7a4a1e', legs: '#3a3a4a' },
  villager: {
    skin: '#e0b088',
    hair: '#d8d8d8',
    tunic: '#5e8c3a',
    belt: '#4a3520',
    legs: '#5a4a3a',
  },
  mage: { skin: '#f2d0b0', hair: '#7a3fa0', tunic: '#8a2f4f', belt: '#d8b04a', legs: '#3a2a3a' },
};

function drawCharacter(file: string, palette: CharacterPalette): void {
  const c = new Canvas(T * 3, T * 4);
  const skin = hex(palette.skin);
  const hair = hex(palette.hair);
  const tunic = hex(palette.tunic);
  const belt = hex(palette.belt);
  const legs = hex(palette.legs);
  const eye = hex('#1a1a1a');

  ROWS.forEach((dir, row) => {
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * T;
      const oy = row * T;
      // Frame 1 is standing; 0 and 2 step with opposite legs.
      const stride = frame === 1 ? 0 : frame === 0 ? -2 : 2;
      const bob = frame === 1 ? 0 : 1;
      c.rect(ox + 11, oy + 30, 10, 2, hex('#000000', 60)); // shadow
      // legs
      if (dir === 'left' || dir === 'right') {
        c.rect(ox + 13 + stride, oy + 24, 3, 6, legs);
        c.rect(ox + 16 - stride, oy + 24, 3, 6, legs);
      } else {
        c.rect(ox + 12, oy + 24 + Math.max(stride, 0) / 2, 3, 6 - Math.max(stride, 0) / 2, legs);
        c.rect(ox + 17, oy + 24 + Math.max(-stride, 0) / 2, 3, 6 - Math.max(-stride, 0) / 2, legs);
      }
      // body
      c.rect(ox + 10, oy + 15 + bob, 12, 10, tunic);
      c.rect(ox + 10, oy + 21 + bob, 12, 2, belt);
      // head
      c.circle(ox + 16, oy + 10 + bob, 6, skin);
      // hair and face per direction
      const hy = oy + 4 + bob;
      if (dir === 'up') {
        c.rect(ox + 10, hy, 13, 10, hair);
      } else {
        c.rect(ox + 10, hy, 13, 4, hair);
        if (dir === 'down') {
          c.rect(ox + 13, oy + 10 + bob, 2, 2, eye);
          c.rect(ox + 18, oy + 10 + bob, 2, 2, eye);
        } else if (dir === 'left') {
          c.rect(ox + 16, hy, 7, 8, hair);
          c.rect(ox + 12, oy + 10 + bob, 2, 2, eye);
        } else {
          c.rect(ox + 10, hy, 7, 8, hair);
          c.rect(ox + 19, oy + 10 + bob, 2, 2, eye);
        }
      }
    }
  });
  c.save(join(ROOT, 'assets', 'characters', `${file}.png`));
}

/** Filled ellipse centered on (cx, cy). */
function ellipse(c: Canvas, cx: number, cy: number, rx: number, ry: number, color: RGBA): void {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) c.set(cx + x, cy + y, color);
    }
  }
}

/** Filled triangle: a pixel is inside when all three edge functions share a sign. */
function triangle(c: Canvas, pts: [number, number][], color: RGBA): void {
  const [[ax, ay], [bx, by], [cx, cy]] = pts as [
    [number, number],
    [number, number],
    [number, number],
  ];
  for (let y = Math.min(ay, by, cy); y <= Math.max(ay, by, cy); y++) {
    for (let x = Math.min(ax, bx, cx); x <= Math.max(ax, bx, cx); x++) {
      const w0 = (bx - x) * (cy - y) - (cx - x) * (by - y);
      const w1 = (cx - x) * (ay - y) - (ax - x) * (cy - y);
      const w2 = (ax - x) * (by - y) - (bx - x) * (ay - y);
      const inside = (w0 >= 0 && w1 >= 0 && w2 >= 0) || (w0 <= 0 && w1 <= 0 && w2 <= 0);
      if (inside) c.set(x, y, color);
    }
  }
}

// Battle art: one 64x64 image per enemy, feet at the bottom center.
const ENEMIES: Record<string, (c: Canvas) => void> = {
  slime: (c) => {
    ellipse(c, 32, 62, 20, 3, hex('#000000', 60));
    ellipse(c, 32, 46, 22, 16, hex('#3fb8a8'));
    ellipse(c, 32, 50, 22, 12, hex('#2f9a8c'));
    ellipse(c, 24, 38, 5, 3, hex('#bff2ea'));
    ellipse(c, 26, 46, 3, 4, hex('#10302c'));
    ellipse(c, 38, 46, 3, 4, hex('#10302c'));
  },
  bat: (c) => {
    ellipse(c, 32, 62, 12, 2, hex('#000000', 50));
    triangle(
      c,
      [
        [30, 30],
        [4, 18],
        [12, 42],
      ],
      hex('#5a3a7a'),
    );
    triangle(
      c,
      [
        [34, 30],
        [60, 18],
        [52, 42],
      ],
      hex('#5a3a7a'),
    );
    ellipse(c, 32, 34, 9, 11, hex('#7a4fa0'));
    triangle(
      c,
      [
        [25, 26],
        [28, 16],
        [31, 25],
      ],
      hex('#7a4fa0'),
    );
    triangle(
      c,
      [
        [33, 25],
        [36, 16],
        [39, 26],
      ],
      hex('#7a4fa0'),
    );
    ellipse(c, 28, 32, 2, 2, hex('#ffd24a'));
    ellipse(c, 36, 32, 2, 2, hex('#ffd24a'));
  },
  wolf: (c) => {
    ellipse(c, 32, 62, 24, 3, hex('#000000', 60));
    ellipse(c, 30, 42, 20, 11, hex('#6e6e78'));
    c.rect(14, 46, 5, 15, hex('#5a5a64'));
    c.rect(22, 48, 5, 13, hex('#5a5a64'));
    c.rect(36, 48, 5, 13, hex('#5a5a64'));
    c.rect(43, 46, 5, 15, hex('#5a5a64'));
    triangle(
      c,
      [
        [10, 38],
        [0, 30],
        [8, 46],
      ],
      hex('#6e6e78'),
    );
    ellipse(c, 50, 32, 10, 9, hex('#7c7c86'));
    triangle(
      c,
      [
        [56, 34],
        [64, 38],
        [56, 40],
      ],
      hex('#7c7c86'),
    );
    triangle(
      c,
      [
        [44, 26],
        [46, 14],
        [51, 25],
      ],
      hex('#5a5a64'),
    );
    triangle(
      c,
      [
        [52, 25],
        [56, 14],
        [58, 27],
      ],
      hex('#5a5a64'),
    );
    ellipse(c, 53, 30, 2, 2, hex('#f05a3a'));
  },
};

function drawEnemies(): void {
  for (const [id, draw] of Object.entries(ENEMIES)) {
    const c = new Canvas(64, 64);
    draw(c);
    c.save(join(ROOT, 'assets', 'enemies', `${id}.png`));
  }
}

drawTileset();
for (const [file, palette] of Object.entries(CHARACTERS)) drawCharacter(file, palette);
drawEnemies();
