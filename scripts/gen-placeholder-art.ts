// Generates FreeQuest's original placeholder art for the demo project:
//   assets/tilesets/overworld.png  4x4 grid of 32px tiles
//   assets/characters/<name>.png   3 frames x 4 directions, 32px frames
//   assets/enemies/<id>.png        64x64 battle art
//   assets/system/iconset.png      8x4 grid of 16px item, gear, skill and state icons
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
  get(x: number, y: number): RGBA {
    const i = (y * this.png.width + x) * 4;
    const d = this.png.data;
    return [d[i] ?? 0, d[i + 1] ?? 0, d[i + 2] ?? 0, d[i + 3] ?? 0];
  }
  /** Copy another canvas onto this one at (ox, oy). */
  blit(src: Canvas, ox: number, oy: number): void {
    for (let y = 0; y < src.png.height; y++)
      for (let x = 0; x < src.png.width; x++) {
        const c = src.get(x, y);
        if (c[3] > 0) this.set(ox + x, oy + y, c);
      }
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

/**
 * A treasure chest as a character sheet, so events can show it: the "down"
 * row is closed and the "up" row open (a page picks one with its graphic's
 * facing); every frame of a row is the same, so it never "walks".
 */
function drawChest(): void {
  const c = new Canvas(T * 3, T * 4);
  const wood = hex('#8a5a2b');
  const dark = hex('#5a3818');
  const band = hex('#c9a640');
  const inside = hex('#2a1a0c');
  const gold = hex('#f2d04a');
  ROWS.forEach((dir, row) => {
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * T;
      const oy = row * T;
      c.rect(ox + 6, oy + 28, 20, 2, hex('#000000', 60)); // shadow
      c.rect(ox + 6, oy + 17, 20, 11, wood); // box
      c.rect(ox + 6, oy + 27, 20, 1, dark);
      c.rect(ox + 9, oy + 17, 2, 11, band);
      c.rect(ox + 21, oy + 17, 2, 11, band);
      if (dir === 'up') {
        // Open: the lid stands up behind the box, coins show inside.
        c.rect(ox + 6, oy + 6, 20, 9, dark);
        c.rect(ox + 7, oy + 7, 18, 7, wood);
        c.rect(ox + 6, oy + 15, 20, 2, inside);
        c.rect(ox + 10, oy + 14, 4, 2, gold);
        c.rect(ox + 17, oy + 14, 5, 2, gold);
      } else {
        // Closed: a rounded lid and a lock.
        c.rect(ox + 6, oy + 12, 20, 5, wood);
        c.rect(ox + 7, oy + 11, 18, 1, wood);
        c.rect(ox + 6, oy + 16, 20, 1, dark);
        c.rect(ox + 9, oy + 11, 2, 6, band);
        c.rect(ox + 21, oy + 11, 2, 6, band);
        c.rect(ox + 15, oy + 15, 2, 4, band);
      }
    }
  });
  c.save(join(ROOT, 'assets', 'characters', 'chest.png'));
}

/** A map pinned to the wall: parchment with paths, water and the bridge circled. */
function drawWallMap(): void {
  const c = new Canvas(T * 3, T * 4);
  const paper = hex('#e8d9b0');
  const edge = hex('#b89a62');
  const ink = hex('#6b4a2a');
  const water = hex('#5b8fc7');
  const red = hex('#c0392b');
  for (let row = 0; row < 4; row++)
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * T;
      const oy = row * T;
      c.rect(ox + 5, oy + 7, 22, 17, edge);
      c.rect(ox + 6, oy + 8, 20, 15, paper);
      c.rect(ox + 8, oy + 15, 12, 1, ink); // the path
      c.rect(ox + 13, oy + 11, 1, 5, ink);
      c.rect(ox + 21, oy + 9, 3, 13, water); // the river
      c.rect(ox + 20, oy + 15, 5, 1, ink); // the bridge
      for (const [dx, dy] of [
        [18, 13],
        [19, 12],
        [20, 12],
        [21, 12],
        [22, 12],
        [23, 13],
        [18, 17],
        [19, 18],
        [20, 18],
        [21, 18],
        [22, 18],
        [23, 17],
        [17, 15],
        [24, 15],
      ] as const)
        c.set(ox + dx, oy + dy, red); // circled (twice, roughly)
      c.rect(ox + 15, oy + 5, 2, 3, hex('#8a8a8a')); // the pin
    }
  c.save(join(ROOT, 'assets', 'characters', 'wall-map.png'));
}

/**
 * A stone fireplace: the "down" row is cold (grey logs), the "up" row lit
 * (flames), so a page picks one with its graphic's facing.
 */
function drawHearth(): void {
  const c = new Canvas(T * 3, T * 4);
  const stone = hex('#7d7a78');
  const dark = hex('#4a4746');
  const mortar = hex('#9c9896');
  ROWS.forEach((dir, row) => {
    for (let frame = 0; frame < 3; frame++) {
      const ox = frame * T;
      const oy = row * T;
      c.rect(ox + 3, oy + 4, 26, 26, stone); // the surround
      c.rect(ox + 3, oy + 4, 26, 3, mortar); // the mantel
      for (const y of [12, 20]) c.rect(ox + 3, oy + y, 26, 1, mortar);
      c.rect(ox + 8, oy + 12, 16, 18, dark); // the opening
      c.rect(ox + 10, oy + 26, 12, 2, hex('#6b4423')); // logs
      c.rect(ox + 12, oy + 24, 8, 2, hex('#7a5230'));
      if (dir === 'up') {
        c.rect(ox + 11, oy + 18, 10, 6, hex('#e25822')); // flames
        c.rect(ox + 13, oy + 15, 6, 5, hex('#f4a531'));
        c.rect(ox + 15, oy + 13, 2, 4, hex('#ffe066'));
        c.rect(ox + 12, oy + 21, 2, 2, hex('#ffe066'));
        c.rect(ox + 18, oy + 20, 2, 2, hex('#ffe066'));
      } else {
        c.rect(ox + 12, oy + 23, 8, 1, hex('#5f5f5f')); // ash
      }
    }
  });
  c.save(join(ROOT, 'assets', 'characters', 'hearth.png'));
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

// Icons: 16x16, drawn inside a 1px margin, then outlined in a dark color so
// they read on any window. Index order is what the database's `icon` fields use.
const I = 16;
const ICON_OUTLINE = hex('#1a1420');

/** A line, `width` pixels thick (Bresenham with a square brush). */
function line(c: Canvas, x0: number, y0: number, x1: number, y1: number, color: RGBA, width = 1) {
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    c.rect(x, y, width, width, color);
    if (x === x1 && y === y1) return;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Darken transparent pixels next to the drawing: a 1px outline. */
function outline(c: Canvas): void {
  const solid = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < I && y < I && c.get(x, y)[3] > 0 && !same(c.get(x, y), ICON_OUTLINE);
  const same = (a: RGBA, b: RGBA) => a.every((v, i) => v === b[i]);
  const edge: [number, number][] = [];
  for (let y = 0; y < I; y++)
    for (let x = 0; x < I; x++) {
      if (c.get(x, y)[3] > 0) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))
        edge.push([x, y]);
    }
  for (const [x, y] of edge) c.set(x, y, ICON_OUTLINE);
}

function flask(c: Canvas, liquid: string, shine: string): void {
  c.rect(7, 2, 2, 1, hex('#8a5a2b'));
  c.rect(6, 3, 4, 3, hex('#cfd8e3'));
  c.circle(8, 10, 4, hex('#cfd8e3'));
  c.circle(8, 10, 3, hex(liquid));
  c.rect(5, 9, 7, 1, hex(liquid));
  c.rect(6, 8, 2, 2, hex(shine));
}

const ICONS: ((c: Canvas) => void)[] = [
  // 0 potion (red), 1 ether (blue), 2 antidote (green)
  (c) => flask(c, '#d8333b', '#ff9aa0'),
  (c) => flask(c, '#2f6fd8', '#9cc4ff'),
  (c) => flask(c, '#3aa65a', '#a8f0b6'),
  // 3 revive leaf
  (c) => {
    ellipse(c, 8, 8, 3, 6, hex('#4fbf5a'));
    line(c, 8, 3, 8, 14, hex('#2c7a35'));
    line(c, 8, 7, 10, 5, hex('#2c7a35'));
    line(c, 8, 10, 6, 8, hex('#2c7a35'));
  },
  // 4 map / scroll
  (c) => {
    c.rect(3, 4, 10, 8, hex('#eed9a6'));
    c.rect(2, 3, 2, 10, hex('#c9a86a'));
    c.rect(12, 3, 2, 10, hex('#c9a86a'));
    line(c, 5, 6, 10, 9, hex('#c2453b'));
    c.rect(9, 8, 2, 2, hex('#c2453b'));
  },
  // 5 key
  (c) => {
    c.circle(5, 7, 3, hex('#e6b83a'));
    c.circle(5, 7, 1, [0, 0, 0, 0]);
    c.rect(5, 7, 1, 1, [0, 0, 0, 0]);
    c.rect(8, 7, 6, 2, hex('#e6b83a'));
    c.rect(11, 9, 1, 2, hex('#e6b83a'));
    c.rect(13, 9, 1, 3, hex('#e6b83a'));
  },
  // 6 coins
  (c) => {
    c.circle(6, 10, 4, hex('#d9a227'));
    c.circle(6, 10, 2, hex('#f4d35e'));
    c.circle(10, 6, 4, hex('#e6b83a'));
    c.circle(10, 6, 2, hex('#fbe38a'));
  },
  // 7 gem
  (c) => {
    triangle(
      c,
      [
        [3, 6],
        [13, 6],
        [8, 14],
      ],
      hex('#3cc7d6'),
    );
    c.rect(5, 3, 7, 3, hex('#7fe6ef'));
    triangle(
      c,
      [
        [3, 6],
        [5, 3],
        [5, 6],
      ],
      hex('#7fe6ef'),
    );
    triangle(
      c,
      [
        [13, 6],
        [11, 3],
        [11, 6],
      ],
      hex('#7fe6ef'),
    );
    line(c, 6, 7, 8, 12, hex('#c9f7fb'));
  },
  // 8 sword
  (c) => {
    line(c, 4, 11, 12, 3, hex('#d8dee8'), 2);
    line(c, 5, 11, 12, 4, hex('#9aa6b8'));
    line(c, 2, 9, 6, 13, hex('#8a5a2b'), 2);
    line(c, 2, 13, 4, 11, hex('#5e3a1a'), 2);
  },
  // 9 staff
  (c) => {
    line(c, 3, 13, 10, 6, hex('#8a5a2b'), 2);
    c.circle(11, 4, 2, hex('#a35bd8'));
    c.set(10, 3, hex('#e3c2ff'));
  },
  // 10 shield
  (c) => {
    c.rect(3, 2, 10, 7, hex('#3f6fb5'));
    triangle(
      c,
      [
        [3, 9],
        [12, 9],
        [8, 14],
      ],
      hex('#3f6fb5'),
    );
    c.rect(7, 3, 2, 9, hex('#e6b83a'));
    c.rect(4, 6, 8, 2, hex('#e6b83a'));
  },
  // 11 vest (light armor)
  (c) => {
    c.rect(4, 4, 8, 10, hex('#8f5f34'));
    c.rect(2, 4, 3, 4, hex('#8f5f34'));
    c.rect(11, 4, 3, 4, hex('#8f5f34'));
    c.rect(7, 2, 2, 4, [0, 0, 0, 0]);
    line(c, 8, 6, 8, 13, hex('#5e3a1a'));
    c.rect(5, 9, 6, 1, hex('#b98552'));
  },
  // 12 robe
  (c) => {
    triangle(
      c,
      [
        [8, 2],
        [2, 14],
        [14, 14],
      ],
      hex('#5a4fc0'),
    );
    c.rect(6, 3, 4, 3, hex('#5a4fc0'));
    line(c, 8, 4, 8, 14, hex('#c9c2ff'));
    c.rect(5, 9, 6, 1, hex('#e6b83a'));
  },
  // 13 hat
  (c) => {
    ellipse(c, 8, 11, 7, 2, hex('#e2c46a'));
    c.rect(5, 5, 6, 6, hex('#e2c46a'));
    c.rect(5, 9, 6, 1, hex('#c2453b'));
  },
  // 14 charm
  (c) => {
    line(c, 4, 2, 8, 6, hex('#c9a86a'));
    line(c, 12, 2, 8, 6, hex('#c9a86a'));
    c.circle(8, 10, 4, hex('#3aa65a'));
    c.circle(8, 10, 2, hex('#a8f0b6'));
  },
  // 15 boots
  (c) => {
    c.rect(4, 3, 5, 8, hex('#6b4426'));
    c.rect(4, 10, 9, 4, hex('#6b4426'));
    c.rect(4, 12, 9, 2, hex('#3f2814'));
    c.rect(4, 4, 5, 1, hex('#9b6a3f'));
  },
  // 16 attack (slash)
  (c) => {
    line(c, 2, 12, 12, 2, hex('#ffffff'));
    line(c, 4, 13, 13, 4, hex('#d8dee8'));
    line(c, 6, 14, 14, 6, hex('#9aa6b8'));
  },
  // 17 guard
  (c) => {
    c.rect(3, 2, 10, 7, hex('#9aa6b8'));
    triangle(
      c,
      [
        [3, 9],
        [12, 9],
        [8, 14],
      ],
      hex('#9aa6b8'),
    );
    c.rect(5, 4, 6, 5, hex('#d8dee8'));
    triangle(
      c,
      [
        [5, 9],
        [10, 9],
        [8, 12],
      ],
      hex('#d8dee8'),
    );
  },
  // 18 fire
  (c) => {
    triangle(
      c,
      [
        [8, 1],
        [2, 13],
        [14, 13],
      ],
      hex('#d8333b'),
    );
    ellipse(c, 8, 11, 5, 3, hex('#d8333b'));
    triangle(
      c,
      [
        [8, 5],
        [4, 13],
        [12, 13],
      ],
      hex('#f0882e'),
    );
    ellipse(c, 8, 12, 2, 2, hex('#ffd84a'));
  },
  // 19 ice
  (c) => {
    line(c, 8, 1, 8, 14, hex('#9cdcff'));
    line(c, 2, 4, 14, 11, hex('#9cdcff'));
    line(c, 2, 11, 14, 4, hex('#9cdcff'));
    c.circle(8, 8, 1, hex('#ffffff'));
  },
  // 20 lightning
  (c) => {
    triangle(
      c,
      [
        [10, 1],
        [4, 9],
        [9, 9],
      ],
      hex('#ffd84a'),
    );
    triangle(
      c,
      [
        [7, 7],
        [12, 7],
        [5, 14],
      ],
      hex('#ffd84a'),
    );
  },
  // 21 heal (heart)
  (c) => {
    c.circle(5, 6, 3, hex('#ff6fa0'));
    c.circle(11, 6, 3, hex('#ff6fa0'));
    triangle(
      c,
      [
        [2, 7],
        [14, 7],
        [8, 14],
      ],
      hex('#ff6fa0'),
    );
    c.rect(4, 4, 2, 2, hex('#ffc2d6'));
  },
  // 22 poison
  (c) => {
    c.circle(8, 10, 4, hex('#8e4fc0'));
    triangle(
      c,
      [
        [8, 1],
        [4, 9],
        [12, 9],
      ],
      hex('#8e4fc0'),
    );
    c.rect(6, 9, 2, 2, hex('#d3a8f5'));
    c.set(12, 3, hex('#8e4fc0'));
    c.set(13, 5, hex('#8e4fc0'));
  },
  // 23 star (strength)
  (c) => {
    triangle(
      c,
      [
        [8, 1],
        [5, 10],
        [11, 10],
      ],
      hex('#ffd84a'),
    );
    triangle(
      c,
      [
        [1, 6],
        [15, 6],
        [8, 11],
      ],
      hex('#ffd84a'),
    );
    triangle(
      c,
      [
        [8, 9],
        [3, 14],
        [6, 7],
      ],
      hex('#ffd84a'),
    );
    triangle(
      c,
      [
        [8, 9],
        [13, 14],
        [10, 7],
      ],
      hex('#ffd84a'),
    );
  },
  // 24 sleep
  (c) => {
    const z = (x: number, y: number, s: number, color: RGBA) => {
      line(c, x, y, x + s, y, color);
      line(c, x + s, y, x, y + s, color);
      line(c, x, y + s, x + s, y + s, color);
    };
    z(2, 8, 5, hex('#9cc4ff'));
    z(9, 3, 4, hex('#c9dcff'));
  },
  // 25 knockout (skull)
  (c) => {
    c.circle(8, 7, 5, hex('#eeeae0'));
    c.rect(5, 11, 6, 3, hex('#eeeae0'));
    c.rect(5, 6, 2, 2, hex('#1a1420'));
    c.rect(9, 6, 2, 2, hex('#1a1420'));
    c.rect(7, 12, 1, 2, hex('#1a1420'));
    c.rect(9, 12, 1, 2, hex('#1a1420'));
  },
];

/** Where each demo entry's icon is (the editor's icon picker shows the same grid). */
export const ICON_COLUMNS = 8;

function drawIconset(): void {
  const rows = Math.ceil(ICONS.length / ICON_COLUMNS);
  const sheet = new Canvas(I * ICON_COLUMNS, I * rows);
  ICONS.forEach((draw, i) => {
    const icon = new Canvas(I, I);
    draw(icon);
    outline(icon);
    sheet.blit(icon, (i % ICON_COLUMNS) * I, Math.floor(i / ICON_COLUMNS) * I);
  });
  sheet.save(join(ROOT, 'assets', 'system', 'iconset.png'));
}

drawTileset();
for (const [file, palette] of Object.entries(CHARACTERS)) drawCharacter(file, palette);
drawChest();
drawWallMap();
drawHearth();
drawEnemies();
drawIconset();
