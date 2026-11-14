// Where an MZ tile's picture comes from. MZ numbers tiles across nine sheets:
// B–E and A5 are plain grids; A1–A4 hold autotiles, small blocks of pieces
// that a tile assembles from quarter-tile pieces depending on which
// neighbours it joins. A tile number stores the chosen shape, so the importer
// never has to look at neighbours: it bakes each shape it meets into a plain
// tile.
//
// Clean-room: the tile number ranges and the sheet layouts are MZ's file
// format (what authors draw their art in). The shape table below was worked
// out from MZ maps' numbers (which neighbours each shape joins), and the
// piece selection is our own geometry.

/** Sheets of an MZ tileset, in the order its `tilesetNames` lists them. */
export const SHEETS = ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C', 'D', 'E'] as const;
export type SheetName = (typeof SHEETS)[number];

/** A copy of a square area of a sheet, in units of `size` pixels' fraction of a tile. */
export interface Piece {
  /** Source position in quarter tiles (half a tile each). */
  readonly sx: number;
  readonly sy: number;
  /** Destination quarter within the tile: 0 or 1 each. */
  readonly dx: number;
  readonly dy: number;
}

export type TileSource =
  /** A whole tile from a grid sheet, at column/row in tiles. */
  | { readonly kind: 'tile'; readonly sheet: SheetName; readonly col: number; readonly row: number }
  /** Four quarter pieces from an autotile block. */
  | {
      readonly kind: 'pieces';
      readonly sheet: SheetName;
      readonly pieces: readonly Piece[];
      /** Whether it's animated in MZ (water): only the first frame is used. */
      readonly animated: boolean;
    };

const A1_FIRST = 2048;
const A2_FIRST = 2816;
const A3_FIRST = 4352;
const A4_FIRST = 5888;
const AUTOTILE_END = 8192;
const A5_FIRST = 1536;
const A5_END = 1664;
const SHAPES = 48;

/** Which of a tile's neighbours it joins (diagonals only matter beside two joined sides). */
export interface Joins {
  readonly n: boolean;
  readonly e: boolean;
  readonly s: boolean;
  readonly w: boolean;
  readonly ne: boolean;
  readonly se: boolean;
  readonly sw: boolean;
  readonly nw: boolean;
}

/**
 * The 48 shapes of a floor autotile. 0–15: joined on every side, a bit per
 * corner that isn't (1 top-left, 2 top-right, 4 bottom-right, 8 bottom-left).
 * 16–31: one open side (left, top, right, bottom), two bits for the corners
 * beside the joined sides, clockwise. 32, 33: open left and right, top and
 * bottom. 34–41: two open sides meeting (top-left, top-right, bottom-right,
 * bottom-left), a bit for the opposite corner. 42–45: only one side joined
 * (bottom, right, top, left). 46 (and 47): alone.
 */
export function floorJoins(shape: number): Joins {
  const all = { n: true, e: true, s: true, w: true };
  const bit = (b: number) => (shape & b) === 0;
  if (shape < 16) {
    return { ...all, nw: bit(1), ne: bit(2), se: bit(4), sw: bit(8) };
  }
  const corners = { ne: true, se: true, sw: true, nw: true };
  if (shape < 32) {
    const side = Math.floor((shape - 16) / 4);
    const b = (shape - 16) % 4;
    const first = (b & 1) === 0;
    const second = (b & 2) === 0;
    // Open side, then the two corners on the far side, clockwise.
    if (side === 0) return { ...all, w: false, ...corners, ne: first, se: second };
    if (side === 1) return { ...all, n: false, ...corners, se: first, sw: second };
    if (side === 2) return { ...all, e: false, ...corners, sw: first, nw: second };
    return { ...all, s: false, ...corners, nw: first, ne: second };
  }
  if (shape === 32) return { n: true, e: false, s: true, w: false, ...corners };
  if (shape === 33) return { n: false, e: true, s: false, w: true, ...corners };
  if (shape < 42) {
    const pair = Math.floor((shape - 34) / 2);
    const corner = (shape - 34) % 2 === 0;
    if (pair === 0) return { n: false, e: true, s: true, w: false, ...corners, se: corner };
    if (pair === 1) return { n: false, e: false, s: true, w: true, ...corners, sw: corner };
    if (pair === 2) return { n: true, e: false, s: false, w: true, ...corners, nw: corner };
    return { n: true, e: true, s: false, w: false, ...corners, ne: corner };
  }
  const none = { n: false, e: false, s: false, w: false, ...corners };
  if (shape === 42) return { ...none, s: true };
  if (shape === 43) return { ...none, e: true };
  if (shape === 44) return { ...none, n: true };
  if (shape === 45) return { ...none, w: true };
  return none;
}

/** Wall shapes (16): a bit per open side: 1 left, 2 top, 4 right, 8 bottom. */
export function wallJoins(shape: number): Joins {
  const open = (b: number) => (shape & b) !== 0;
  return {
    w: !open(1),
    n: !open(2),
    e: !open(4),
    s: !open(8),
    ne: true,
    se: true,
    sw: true,
    nw: true,
  };
}

/**
 * Pieces for a floor-format block (2 × 3 tiles = 4 × 6 quarters): the top
 * right tile holds inside corners, the bottom 2 × 2 a bordered area whose
 * outer quarters are edges and whose inner ones are the middle.
 */
function floorPieces(bx: number, by: number, j: Joins): Piece[] {
  return QUARTERS.map(({ dx, dy }) => {
    const vertical = dy === 0 ? j.n : j.s;
    const horizontal = dx === 0 ? j.w : j.e;
    const diagonal = dy === 0 ? (dx === 0 ? j.nw : j.ne) : dx === 0 ? j.sw : j.se;
    if (vertical && horizontal && !diagonal) {
      return { sx: bx + 2 + dx, sy: by + dy, dx, dy };
    }
    const col = horizontal ? (dx === 0 ? 2 : 1) : dx === 0 ? 0 : 3;
    const row = vertical ? (dy === 0 ? 4 : 3) : dy === 0 ? 2 : 5;
    return { sx: bx + col, sy: by + row, dx, dy };
  });
}

/** Pieces for a wall-format block (2 × 2 tiles): the bordered area alone. */
function wallPieces(bx: number, by: number, j: Joins): Piece[] {
  return QUARTERS.map(({ dx, dy }) => {
    const vertical = dy === 0 ? j.n : j.s;
    const horizontal = dx === 0 ? j.w : j.e;
    const col = horizontal ? (dx === 0 ? 2 : 1) : dx === 0 ? 0 : 3;
    const row = vertical ? (dy === 0 ? 2 : 1) : dy === 0 ? 0 : 3;
    return { sx: bx + col, sy: by + row, dx, dy };
  });
}

/** Pieces for a waterfall (2 × 1 tiles per frame): open sides use the outer columns. */
function waterfallPieces(bx: number, by: number, shape: number): Piece[] {
  const w = (shape & 1) === 0;
  const e = (shape & 2) === 0;
  return QUARTERS.map(({ dx, dy }) => {
    const col = dx === 0 ? (w ? 2 : 0) : e ? 1 : 3;
    return { sx: bx + col, sy: by + dy, dx, dy };
  });
}

const QUARTERS = [
  { dx: 0, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 1, dy: 1 },
] as const;

/** Where each A1 kind's block starts, in tiles: [column, row, waterfall]. */
const A1_BLOCKS: readonly (readonly [number, number, boolean])[] = [
  [0, 0, false],
  [0, 3, false],
  [6, 0, false],
  [6, 3, false],
  [8, 0, false],
  [14, 0, true],
  [8, 3, false],
  [14, 3, true],
  [0, 6, false],
  [6, 6, true],
  [0, 9, false],
  [6, 9, true],
  [8, 6, false],
  [14, 6, true],
  [8, 9, false],
  [14, 9, true],
];
/** A1 kinds that animate in MZ (the water ones; 2 and 3 are still). */
const A1_STILL = new Set([2, 3]);

/** A4 block rows alternate: tops (floor format, 3 tiles tall) and walls (2 tall). */
const A4_ROW_Y = [0, 3, 5, 8, 10, 13];

/** How to draw MZ tile `id`, or null for "no tile" (0, and numbers past the sheets). */
export function tileSource(id: number): TileSource | null {
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  if (id < 1024) {
    const sheet = SHEETS[5 + Math.floor(id / 256)] ?? 'B';
    const n = id % 256;
    return {
      kind: 'tile',
      sheet,
      col: (Math.floor(n / 128) % 2) * 8 + (n % 8),
      row: Math.floor((n % 128) / 8),
    };
  }
  if (id >= A5_FIRST && id < A5_END) {
    const n = id - A5_FIRST;
    return { kind: 'tile', sheet: 'A5', col: n % 8, row: Math.floor(n / 8) };
  }
  if (id < A1_FIRST || id >= AUTOTILE_END) return null;

  const shape = (id - A1_FIRST) % SHAPES;
  if (id < A2_FIRST) {
    const kind = Math.floor((id - A1_FIRST) / SHAPES);
    const [col, row, waterfall] = A1_BLOCKS[kind] ?? [0, 0, false];
    const animated = !A1_STILL.has(kind);
    const pieces = waterfall
      ? waterfallPieces(col * 2, row * 2, shape)
      : floorPieces(col * 2, row * 2, floorJoins(shape));
    return { kind: 'pieces', sheet: 'A1', pieces, animated };
  }
  if (id < A3_FIRST) {
    const kind = Math.floor((id - A2_FIRST) / SHAPES);
    const pieces = floorPieces((kind % 8) * 4, Math.floor(kind / 8) * 6, floorJoins(shape));
    return { kind: 'pieces', sheet: 'A2', pieces, animated: false };
  }
  if (id < A4_FIRST) {
    const kind = Math.floor((id - A3_FIRST) / SHAPES);
    const pieces = wallPieces((kind % 8) * 4, Math.floor(kind / 8) * 4, wallJoins(shape));
    return { kind: 'pieces', sheet: 'A3', pieces, animated: false };
  }
  const kind = Math.floor((id - A4_FIRST) / SHAPES);
  const row = Math.floor(kind / 8);
  const bx = (kind % 8) * 4;
  const by = (A4_ROW_Y[row] ?? 0) * 2;
  const pieces =
    row % 2 === 0 ? floorPieces(bx, by, floorJoins(shape)) : wallPieces(bx, by, wallJoins(shape));
  return { kind: 'pieces', sheet: 'A4', pieces, animated: false };
}
