import { EMPTY_TILE, type GameMap, type Tileset } from '@freequest/schema';

/** Answers "can a character stand on this cell?". */
export interface Passability {
  readonly width: number;
  readonly height: number;
  isPassable(x: number, y: number): boolean;
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

  constructor(
    readonly width: number,
    readonly height: number,
    blocked: Uint8Array,
  ) {
    if (blocked.length !== width * height) {
      throw new Error(`CollisionMap: expected ${width * height} cells, got ${blocked.length}`);
    }
    this.blocked = blocked;
  }

  static fromMap(map: GameMap, tileset: Tileset): CollisionMap {
    const { width, height } = map;
    const blocked = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let counted = 0;
        let isBlocked = false;
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
        }
        blocked[y * width + x] = isBlocked || counted === 0 ? 1 : 0;
      }
    }
    return new CollisionMap(width, height, blocked);
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
}
