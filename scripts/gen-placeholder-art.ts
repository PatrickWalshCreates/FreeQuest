// Generates FreeQuest's original placeholder art for the demo project:
//   assets/tilesets/overworld.png  4x4 grid of 32px tiles
//   assets/characters/<name>.png   3 frames x 4 directions, 32px frames
//   assets/enemies/<id>.png        64x64 battle art
//   assets/system/iconset.png      8x4 grid of 16px item, gear, skill and state icons
//   assets/system/balloons.png     8 balloons (rows) of 6 frames of 24px
//   assets/animations/*.png        animation frames of 32px in a row (sparkle, slash)
//   assets/system/title.png        the title screen picture (480x352)
//   assets/pictures/meadow-map.png the elder's map, shown as a picture
//   assets/battlebacks/meadow.png  the meadow behind battles (480x352)
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

// Message faces: one row of 48 × 48 portraits per person (calm, then glad).
const F = 48;
interface FacePalette {
  readonly skin: string;
  readonly shade: string;
  readonly hair: string;
  readonly clothes: string;
  readonly backdrop: string;
  readonly style: 'elder' | 'mira';
}

const FACES: Record<string, FacePalette> = {
  elder: {
    skin: '#e0b088',
    shade: '#c08e68',
    hair: '#e4e4e8',
    clothes: '#5e8c3a',
    backdrop: '#33452e',
    style: 'elder',
  },
  mira: {
    skin: '#f2d0b0',
    shade: '#d6ad8c',
    hair: '#7a3fa0',
    clothes: '#8a2f4f',
    backdrop: '#3a2b4a',
    style: 'mira',
  },
};

function drawFace(p: FacePalette, glad: boolean): Canvas {
  const c = new Canvas(F, F);
  const skin = hex(p.skin);
  const shade = hex(p.shade);
  const hair = hex(p.hair);
  const dark = hex('#1e1a24');
  const clothes = hex(p.clothes);
  // Shoulders.
  ellipse(c, 24, 50, 19, 10, clothes);
  // Hair behind the head (Mira's falls to the shoulders).
  if (p.style === 'mira') {
    ellipse(c, 24, 22, 15, 15, hair);
    c.rect(9, 22, 6, 20, hair);
    c.rect(33, 22, 6, 20, hair);
  }
  // The neck, in front of the hair behind the head.
  c.rect(20, 34, 9, 8, shade);
  // Head, with a shaded jaw.
  ellipse(c, 24, 23, 11, 13, skin);
  // The jaw's edge: the lowest skin pixel of each column, shaded (only skin, never hair).
  const isSkin = (x: number, y: number) => c.get(x, y).every((v, i) => v === skin[i]);
  for (let x = 13; x <= 35; x++) {
    for (let y = F - 1; y >= 24; y--) {
      if (!isSkin(x, y)) continue;
      c.set(x, y, shade);
      break;
    }
  }
  // A lone light pixel left between shaded ones (the chin's tip pokes one row lower).
  const isShade = (x: number, y: number) => c.get(x, y).every((v, i) => v === shade[i]);
  for (let y = 30; y < F - 1; y++)
    for (let x = 14; x <= 34; x++)
      if (isSkin(x, y) && isShade(x - 1, y) && isShade(x + 1, y) && isShade(x, y + 1))
        c.set(x, y, shade);
  // Ears.
  c.rect(12, 22, 2, 5, shade);
  c.rect(35, 22, 2, 5, shade);
  if (p.style === 'mira') {
    // Fringe across the forehead, parted to one side.
    ellipse(c, 24, 13, 12, 6, hair);
    triangle(
      c,
      [
        [13, 13],
        [21, 13],
        [14, 21],
      ],
      hair,
    );
    triangle(
      c,
      [
        [24, 13],
        [35, 13],
        [34, 20],
      ],
      hair,
    );
  } else {
    // Bald crown with white tufts over the ears, bushy brows and a beard.
    c.rect(11, 17, 4, 8, hair);
    c.rect(34, 17, 4, 8, hair);
    ellipse(c, 24, 33, 9, 6, hair);
    c.rect(20, 29, 9, 2, hair); // moustache
  }
  // Eyes: open when calm, happy arcs when glad.
  for (const ex of [19, 28]) {
    if (glad) {
      line(c, ex - 1, 23, ex, 22, dark);
      line(c, ex + 1, 22, ex + 2, 23, dark);
    } else {
      c.rect(ex, 21, 2, 3, dark);
      c.set(ex, 21, hex('#ffffff'));
    }
    // Brows: heavy and white for the elder.
    c.rect(ex - 1, 18, 4, p.style === 'elder' ? 2 : 1, p.style === 'elder' ? hair : dark);
  }
  // Mouth (the elder's is in his beard).
  const my = p.style === 'elder' ? 32 : 30;
  if (glad) {
    line(c, 21, my, 22, my + 1, dark);
    c.rect(23, my + 1, 3, 1, dark);
    line(c, 26, my + 1, 27, my, dark);
  } else {
    c.rect(22, my, 5, 1, p.style === 'elder' ? shade : dark);
  }
  // Cheeks.
  if (glad) {
    c.rect(16, 26, 2, 1, hex('#e88a8a'));
    c.rect(31, 26, 2, 1, hex('#e88a8a'));
  }
  // A dark outline, then a rounded backdrop behind everything.
  const outlined = new Canvas(F, F);
  outlined.blit(c, 0, 0);
  for (let y = 0; y < F; y++)
    for (let x = 0; x < F; x++) {
      if (c.get(x, y)[3] > 0) continue;
      const near = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx = 0, ny = 0]) => nx >= 0 && ny >= 0 && nx < F && ny < F && c.get(nx, ny)[3] > 0);
      if (near) outlined.set(x, y, dark);
    }
  const face = new Canvas(F, F);
  const back = hex(p.backdrop);
  for (let y = 0; y < F; y++)
    for (let x = 0; x < F; x++) {
      // Rounded corners: skip pixels outside a 4px radius.
      const cx = x < 4 ? 4 - x : x > F - 5 ? x - (F - 5) : 0;
      const cy = y < 4 ? 4 - y : y > F - 5 ? y - (F - 5) : 0;
      if (cx * cx + cy * cy <= 16) face.set(x, y, back);
    }
  face.blit(outlined, 0, 0);
  return face;
}

function drawFaces(): void {
  for (const [file, palette] of Object.entries(FACES)) {
    const sheet = new Canvas(F * 2, F);
    sheet.blit(drawFace(palette, false), 0, 0);
    sheet.blit(drawFace(palette, true), F, 0);
    sheet.save(join(ROOT, 'assets', 'faces', `${file}.png`));
  }
}

// Balloons over characters: one row per kind, 6 frames of 24 px (it pops up, then bobs).
const B = 24;
const BALLOON_KINDS = ['surprise', 'question', 'music', 'heart', 'anger', 'sweat', 'idea', 'sleep'];

/** The symbol inside a balloon, drawn in a 24 px cell around (12, 10). */
function balloonSymbol(c: Canvas, kind: string, ox: number, oy: number): void {
  const ink = hex('#2a2230');
  const at = (x: number, y: number, w: number, h: number, color: RGBA) =>
    c.rect(ox + x, oy + y, w, h, color);
  switch (kind) {
    case 'surprise':
      at(11, 4, 2, 8, hex('#d83a3a'));
      at(11, 14, 2, 2, hex('#d83a3a'));
      break;
    case 'question':
      at(9, 5, 6, 2, hex('#3a6ad8'));
      at(14, 6, 2, 4, hex('#3a6ad8'));
      at(11, 10, 3, 2, hex('#3a6ad8'));
      at(11, 12, 2, 1, hex('#3a6ad8'));
      at(11, 14, 2, 2, hex('#3a6ad8'));
      break;
    case 'music':
      at(13, 4, 1, 9, ink);
      at(13, 4, 4, 2, ink);
      at(9, 11, 5, 4, ink);
      break;
    case 'heart':
      ellipse(c, ox + 9, oy + 8, 3, 3, hex('#e04a78'));
      ellipse(c, ox + 15, oy + 8, 3, 3, hex('#e04a78'));
      triangle(
        c,
        [
          [ox + 6, oy + 9],
          [ox + 18, oy + 9],
          [ox + 12, oy + 16],
        ],
        hex('#e04a78'),
      );
      break;
    case 'anger':
      for (const [dx, dy] of [
        [0, 0],
        [5, 0],
        [0, 5],
        [5, 5],
      ] as const) {
        at(8 + dx, 5 + dy, 2, 2, hex('#d83a3a'));
      }
      at(10, 7, 3, 1, hex('#d83a3a'));
      at(10, 10, 3, 1, hex('#d83a3a'));
      at(9, 7, 1, 3, hex('#d83a3a'));
      at(13, 7, 1, 3, hex('#d83a3a'));
      break;
    case 'sweat':
      triangle(
        c,
        [
          [ox + 12, oy + 4],
          [ox + 9, oy + 11],
          [ox + 15, oy + 11],
        ],
        hex('#4aa0e0'),
      );
      ellipse(c, ox + 12, oy + 12, 3, 3, hex('#4aa0e0'));
      at(11, 10, 1, 2, hex('#cfe8fa'));
      break;
    case 'idea':
      ellipse(c, ox + 12, oy + 8, 4, 4, hex('#f2c83a'));
      at(10, 12, 5, 2, hex('#f2c83a'));
      at(10, 14, 5, 2, hex('#8a8a96'));
      at(11, 6, 1, 2, hex('#fff6c8'));
      break;
    case 'sleep':
      for (const [x, y, n] of [
        [7, 10, 4],
        [13, 5, 4],
      ] as const) {
        at(x, y, n, 1, ink);
        line(c, ox + x + n - 1, oy + y + 1, ox + x, oy + y + n - 2, ink);
        at(x, y + n - 1, n, 1, ink);
      }
      break;
  }
}

function drawBalloons(): void {
  const frames = 6;
  const sheet = new Canvas(B * frames, B * BALLOON_KINDS.length);
  const white = hex('#fbfbf7');
  const ink = hex('#2a2230');
  BALLOON_KINDS.forEach((kind, row) => {
    for (let f = 0; f < frames; f++) {
      const cell = new Canvas(B, B);
      const scale = [0.4, 0.75, 1, 1, 1, 1][f] ?? 1;
      const bob = f >= 3 ? ([0, -1, 0][f - 3] ?? 0) : 0;
      const rx = Math.round(10 * scale);
      const ry = Math.round(8 * scale);
      const cy = 18 - ry + bob;
      ellipse(cell, 12, cy, rx, ry, white);
      if (scale === 1) {
        triangle(
          cell,
          [
            [10, cy + ry - 1],
            [14, cy + ry - 1],
            [11, cy + ry + 3],
          ],
          white,
        );
        balloonSymbol(cell, kind, 0, cy - 10);
      }
      // A dark outline around the white.
      const out = new Canvas(B, B);
      out.blit(cell, 0, 0);
      for (let y = 0; y < B; y++)
        for (let x = 0; x < B; x++) {
          if (cell.get(x, y)[3] > 0) continue;
          const near = [
            [x - 1, y],
            [x + 1, y],
            [x, y - 1],
            [x, y + 1],
          ].some(
            ([nx = 0, ny = 0]) => nx >= 0 && ny >= 0 && nx < B && ny < B && cell.get(nx, ny)[3] > 0,
          );
          if (near) out.set(x, y, ink);
        }
      sheet.blit(out, f * B, row * B);
    }
  });
  sheet.save(join(ROOT, 'assets', 'system', 'balloons.png'));
}

// Animations: frames of 32 px in one row. A sparkle of light (healing) and a sword slash.
const A = 32;

function drawSparkle(): void {
  const frames = 8;
  const sheet = new Canvas(A * frames, A);
  const colors = [hex('#ffffff'), hex('#b8f5a8'), hex('#6ad870')];
  for (let f = 0; f < frames; f++) {
    const cell = new Canvas(A, A);
    const t = f / (frames - 1);
    // Six twinkles rising and spreading out, then fading to green.
    for (let k = 0; k < 6; k++) {
      const angle = (k / 6) * Math.PI * 2 + t * 1.5;
      const r = 3 + t * 11;
      const x = Math.round(16 + Math.cos(angle) * r);
      const y = Math.round(18 + Math.sin(angle) * r * 0.7 - t * 8);
      const color = colors[Math.min(2, Math.floor(t * 3))] ?? colors[2];
      if (!color || f === frames - 1) continue;
      const size = k % 2 === 0 && f < 6 ? 2 : 1;
      cell.rect(x - size, y, size * 2 + 1, 1, color);
      cell.rect(x, y - size, 1, size * 2 + 1, color);
    }
    if (f < 3) cell.circle(16, 18, 2 + f, hex('#e8ffe0'));
    sheet.blit(cell, f * A, 0);
  }
  sheet.save(join(ROOT, 'assets', 'animations', 'sparkle.png'));
}

function drawSlash(): void {
  const frames = 6;
  const sheet = new Canvas(A * frames, A);
  for (let f = 0; f < frames; f++) {
    const cell = new Canvas(A, A);
    // The blade's trail grows across, then thins and fades.
    const reach = Math.min(1, (f + 1) / 3);
    const x1 = Math.round(4 + 24 * reach);
    const y1 = Math.round(4 + 24 * reach);
    const width = f < 3 ? 3 : f < 5 ? 2 : 1;
    const start = f < 3 ? 0 : (f - 2) * 6;
    line(cell, 4 + start, 4 + start, x1, y1, hex(f < 4 ? '#ffffff' : '#c8d4ff'), width);
    if (f >= 1 && f <= 3) line(cell, 6 + start, 3 + start, x1 + 1, y1 - 2, hex('#9ab0ff'));
    sheet.blit(cell, f * A, 0);
  }
  sheet.save(join(ROOT, 'assets', 'animations', 'slash.png'));
}

// The title screen: a meadow at dawn under a pale sky, hills, the elder's house and the bridge.
function drawTitle(): void {
  const W = 480;
  const H = 352;
  const c = new Canvas(W, H);
  const sky = [hex('#2b3a6b'), hex('#4f5f96'), hex('#8a7fb0'), hex('#d99a8a'), hex('#f2c48a')];
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, y / (H * 0.62));
    const band = Math.min(sky.length - 1, Math.floor(t * sky.length));
    // Dithered bands: alternate neighbouring colours near each boundary.
    const next = Math.min(sky.length - 1, band + 1);
    const frac = t * sky.length - band;
    for (let x = 0; x < W; x++) {
      const color = frac > 0.75 && (x + y) % 2 === 0 ? sky[next] : sky[band];
      if (color) c.set(x, y, color);
    }
  }
  // A low sun and a few stars still out.
  c.circle(330, 214, 26, hex('#fde6a8'));
  c.circle(330, 214, 20, hex('#fff4d0'));
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(noise(i, 1, 7) * W);
    const y = Math.floor(noise(i, 2, 7) * 110);
    c.set(x, y, hex('#e8ecff', 140 + Math.floor(noise(i, 3, 7) * 110)));
  }
  // Far hills, near hills, and the meadow.
  const hill = (base: number, amp: number, freq: number, phase: number, color: RGBA) => {
    for (let x = 0; x < W; x++) {
      const top = Math.round(
        base - amp * Math.sin(x * freq + phase) - amp * 0.5 * Math.sin(x * freq * 2.3),
      );
      for (let y = top; y < H; y++) c.set(x, y, color);
    }
  };
  hill(236, 14, 0.012, 1.2, hex('#5d6f8f'));
  hill(256, 12, 0.017, 0.3, hex('#4f7a52'));
  hill(276, 8, 0.023, 2.0, hex('#5f9a4e'));
  for (let i = 0; i < 260; i++) {
    const x = Math.floor(noise(i, 4, 9) * W);
    const y = 282 + Math.floor(noise(i, 5, 9) * (H - 282));
    c.set(x, y, noise(i, 6, 9) < 0.5 ? hex('#7fb85c') : hex('#4f8a40'));
  }
  // The elder's house: walls, a dark roof, a lit window.
  c.rect(92, 236, 54, 34, hex('#b98b5e'));
  triangle(
    c,
    [
      [84, 238],
      [154, 238],
      [119, 208],
    ],
    hex('#3f4a72'),
  );
  c.rect(124, 246, 10, 10, hex('#f6d27a'));
  c.rect(102, 252, 12, 18, hex('#5a3a28'));
  // A path winding down to the front, and the bridge over a stream on the right.
  for (let y = 270; y < H; y++) {
    const cx = 108 + Math.round(Math.sin(y * 0.05) * 10 + (y - 270) * 0.6);
    c.rect(
      cx - 4 - Math.floor((y - 270) / 14),
      y,
      8 + Math.floor((y - 270) / 7),
      1,
      hex('#c9a46a'),
    );
  }
  for (let y = 262; y < H; y++)
    c.rect(392 + Math.round(Math.sin(y * 0.08) * 6), y, 22, 1, hex('#5c8fd6'));
  c.rect(384, 290, 40, 6, hex('#8a5a34'));
  c.rect(384, 288, 40, 2, hex('#b07a4a'));
  // Two trees.
  for (const [tx, ty] of [
    [40, 262],
    [218, 250],
  ] as const) {
    c.rect(tx - 2, ty, 4, 14, hex('#5a3a28'));
    c.circle(tx, ty - 6, 11, hex('#2f6a3a'));
    c.circle(tx - 3, ty - 9, 5, hex('#3f8a4a'));
  }
  c.save(join(ROOT, 'assets', 'system', 'title.png'));
}

// Behind battles: the meadow by day. Calm and low in contrast, so enemies stand out; the
// ground starts a little above where they stand (60% down the screen).
function drawBattleback(): void {
  const W = 480;
  const H = 352;
  const c = new Canvas(W, H);
  const horizon = Math.round(H * 0.5);
  const sky = [hex('#5b86c9'), hex('#6f98d4'), hex('#86abdc'), hex('#a3c1e4'), hex('#c3d7ec')];
  for (let y = 0; y < horizon; y++) {
    const t = y / horizon;
    const band = Math.min(sky.length - 1, Math.floor(t * sky.length));
    const next = Math.min(sky.length - 1, band + 1);
    const frac = t * sky.length - band;
    for (let x = 0; x < W; x++) {
      const color = frac > 0.75 && (x + y) % 2 === 0 ? sky[next] : sky[band];
      if (color) c.set(x, y, color);
    }
  }
  // Soft clouds: clusters of pale circles.
  for (const [cx, cy, size] of [
    [80, 58, 1],
    [250, 34, 1.4],
    [410, 76, 0.9],
  ] as const) {
    for (let i = 0; i < 6; i++) {
      const dx = Math.round((noise(i, cx, 3) - 0.5) * 60 * size);
      const dy = Math.round((noise(i, cy, 4) - 0.5) * 12 * size);
      c.circle(cx + dx, cy + dy, Math.round((9 + noise(i, 5, 5) * 8) * size), hex('#eef4fb'));
    }
  }
  // Far mountains, a line of trees, then the grass.
  const ridge = (base: number, amp: number, freq: number, phase: number, color: RGBA) => {
    for (let x = 0; x < W; x++) {
      const top = Math.round(
        base - amp * Math.abs(Math.sin(x * freq + phase)) - amp * 0.4 * Math.sin(x * freq * 3.1),
      );
      for (let y = top; y < H; y++) c.set(x, y, color);
    }
  };
  ridge(horizon, 38, 0.011, 0.7, hex('#7f96bf'));
  ridge(horizon + 6, 20, 0.019, 2.1, hex('#6a86a8'));
  for (let x = 0; x < W; x += 6) {
    const r = 6 + Math.floor(noise(x, 7, 6) * 6);
    c.circle(x, horizon + 12 - Math.floor(noise(x, 8, 6) * 6), r, hex('#3f7046'));
  }
  c.rect(0, horizon + 14, W, H - horizon - 14, hex('#5e9a4c'));
  // Lighter bands of grass toward the front, and tufts.
  for (let y = horizon + 14; y < H; y++) {
    if ((y - horizon) % 23 < 9) {
      for (let x = (y % 2) * 1; x < W; x += 2) c.set(x, y, hex('#67a454'));
    }
  }
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(noise(i, 9, 11) * W);
    const y = horizon + 18 + Math.floor(noise(i, 10, 11) * (H - horizon - 18));
    c.set(x, y, noise(i, 12, 11) < 0.5 ? hex('#7fb85c') : hex('#4f8a40'));
    c.set(x, y - 1, hex('#7fb85c'));
  }
  // A few flowers.
  for (let i = 0; i < 40; i++) {
    const x = Math.floor(noise(i, 13, 12) * W);
    const y = horizon + 30 + Math.floor(noise(i, 14, 12) * (H - horizon - 30));
    c.set(x, y, noise(i, 15, 12) < 0.5 ? hex('#f3e27a') : hex('#f2f2f2'));
  }
  c.save(join(ROOT, 'assets', 'battlebacks', 'meadow.png'));
}

// The elder's hand-drawn map of the meadow, shown as a picture when it's read.
function drawMeadowMap(): void {
  const W = 200;
  const H = 150;
  const c = new Canvas(W, H);
  const paper = hex('#e9d9b0');
  const ink = hex('#5a4630');
  c.rect(4, 4, W - 8, H - 8, paper);
  for (let i = 0; i < 400; i++) {
    const x = 4 + Math.floor(noise(i, 1, 11) * (W - 8));
    const y = 4 + Math.floor(noise(i, 2, 11) * (H - 8));
    c.set(x, y, hex('#dccb9e'));
  }
  // A ragged edge.
  for (let x = 4; x < W - 4; x++) {
    if (noise(x, 3, 11) < 0.4) c.set(x, 4, hex('#000000', 0));
    if (noise(x, 4, 11) < 0.4) c.set(x, H - 5, hex('#000000', 0));
  }
  // The stream and the bridge, the path, the house, trees and the start.
  for (let y = 10; y < H - 10; y++)
    c.rect(150 + Math.round(Math.sin(y * 0.1) * 5), y, 6, 1, hex('#6a8ec0'));
  c.rect(140, 40, 26, 4, ink);
  line(c, 30, 120, 70, 90, ink);
  line(c, 70, 90, 120, 92, ink);
  line(c, 120, 92, 142, 44, ink);
  line(c, 70, 90, 46, 50, ink);
  c.rect(36, 36, 18, 12, ink);
  triangle(
    c,
    [
      [34, 37],
      [56, 37],
      [45, 28],
    ],
    ink,
  );
  for (const [tx, ty] of [
    [100, 40],
    [110, 120],
    [20, 70],
    [176, 110],
  ] as const) {
    c.circle(tx, ty, 4, hex('#5f8a50'));
  }
  // An X where the bridge is, and a dot for "you are here".
  line(c, 166, 24, 174, 32, hex('#b03a2e'), 2);
  line(c, 174, 24, 166, 32, hex('#b03a2e'), 2);
  c.circle(70, 90, 3, hex('#b03a2e'));
  c.save(join(ROOT, 'assets', 'pictures', 'meadow-map.png'));
}

drawTileset();
for (const [file, palette] of Object.entries(CHARACTERS)) drawCharacter(file, palette);
drawChest();
drawWallMap();
drawHearth();
drawEnemies();
drawIconset();
drawFaces();
drawBalloons();
drawSparkle();
drawSlash();
drawTitle();
drawMeadowMap();
drawBattleback();
