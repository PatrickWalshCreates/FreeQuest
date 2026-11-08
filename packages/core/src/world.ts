import type { GameMap, Manifest, Tileset } from '@freequest/schema';
import { CollisionMap } from './collision.js';
import { GridMover } from './grid-mover.js';
import type { InputState } from './input.js';

export interface WorldOptions {
  manifest: Manifest;
  map: GameMap;
  tileset: Tileset;
}

/** The live game state for one map. Advanced only through `step`. */
export class World {
  readonly map: GameMap;
  readonly tileset: Tileset;
  readonly collision: CollisionMap;
  readonly player: GridMover;

  constructor({ manifest, map, tileset }: WorldOptions) {
    if (map.tileset !== tileset.id) {
      throw new Error(`map "${map.id}" uses tileset "${map.tileset}", got "${tileset.id}"`);
    }
    this.map = map;
    this.tileset = tileset;
    this.collision = CollisionMap.fromMap(map, tileset);
    const { start } = manifest;
    if (!this.collision.inBounds(start.x, start.y)) {
      throw new Error(`start position (${start.x}, ${start.y}) is outside map "${map.id}"`);
    }
    this.player = new GridMover({
      x: start.x,
      y: start.y,
      direction: start.direction,
      speed: manifest.player.speed,
    });
  }

  /** Map size in pixels. */
  get pixelWidth(): number {
    return this.map.width * this.tileset.tileWidth;
  }

  get pixelHeight(): number {
    return this.map.height * this.tileset.tileHeight;
  }

  /** Advance the simulation by one fixed step of `dt` seconds. */
  step(dt: number, input: InputState): void {
    this.player.update(dt, this.collision, () => input.heldDirection());
  }
}
