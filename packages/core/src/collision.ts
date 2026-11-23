import { type Direction, EMPTY_TILE, type GameMap, type Tileset } from '@freequest/schema';

/** Answers "can a character stand on this cell?" (and cross from one to the next). */
export interface Passability {
  readonly width: number;
  readonly height: number;
  isPassable(x: number, y: number): boolean;
  /**
   * Whether a step from (x, y) by (dx, dy), one tile across or along, crosses
   * no blocked side: neither the side it leaves nor the side it enters.
   * Without it, every side is open.
   */
  canCross?(x: number, y: number, dx: number, dy: number): boolean;
}

/** A blocked side as a bit of a cell's side mask. */
export const SIDE_BITS: Readonly<Record<Direction, number>> = { up: 1, down: 2, left: 4, right: 8 };

/** The bit for the side a step by (dx, dy) leaves through (0 for no step). */
function sideOf(dx: number, dy: number): number {
  if (dx > 0) return SIDE_BITS.right;
  if (dx < 0) return SIDE_BITS.left;
  if (dy > 0) return SIDE_BITS.down;
  if (dy < 0) return SIDE_BITS.up;
  return 0;
}

/**
 * Passability grid derived from a map and its tileset.
 *
 * A cell is passable when it has at least one tile that counts for collision
 * and every such tile is passable. Tiles flagged `above` (drawn over
 * characters) do not count. Cells outside the map are never passable.
 */
export class CollisionMap implements Passability {
  private readonly blocked: Uint8Array;
  /** Per cell, its blocked sides (`SIDE_BITS`). */
  private readonly sides: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    blocked: Uint8Array,
    sides: Uint8Array = new Uint8Array(width * height),
  ) {
    if (blocked.length !== width * height || sides.length !== width * height) {
      throw new Error(`CollisionMap: expected ${width * height} cells, got ${blocked.length}`);
    }
    this.blocked = blocked;
    this.sides = sides;
  }

  static fromMap(map: GameMap, tileset: Tileset): CollisionMap {
    const { width, height } = map;
    const blocked = new Uint8Array(width * height);
    const sides = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let counted = 0;
        let isBlocked = false;
        let cellSides = 0;
        for (const layer of map.layers) {
          const index = layer.data[y]?.[x] ?? EMPTY_TILE;
          if (index === EMPTY_TILE) continue;
          const tile = tileset.tiles[index];
          if (!tile) {
            throw new Error(
              `map "${map.id}": tile ${index} at (${x}, ${y}) not in tileset "${tileset.id}"`,
            );
          }
          if (tile.above) continue;
          counted++;
          if (!tile.passable) isBlocked = true;
          // Every tile on the cell adds its blocked sides.
          for (const side of tile.blocks ?? []) cellSides |= SIDE_BITS[side];
        }
        blocked[y * width + x] = isBlocked || counted === 0 ? 1 : 0;
        sides[y * width + x] = cellSides;
      }
    }
    return new CollisionMap(width, height, blocked, sides);
  }

  inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.width &&
      y < this.height
    );
  }

  isPassable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.blocked[y * this.width + x] === 0;
  }

  /** A cell's blocked sides (`SIDE_BITS`); none outside the map. */
  sidesAt(x: number, y: number): number {
    return this.inBounds(x, y) ? (this.sides[y * this.width + x] ?? 0) : 0;
  }

  canCross(x: number, y: number, dx: number, dy: number): boolean {
    const leaving = sideOf(dx, dy);
    const entering = sideOf(-dx, -dy);
    return (this.sidesAt(x, y) & leaving) === 0 && (this.sidesAt(x + dx, y + dy) & entering) === 0;
  }
}
