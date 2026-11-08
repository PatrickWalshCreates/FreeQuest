import type { Passability } from './collision.js';
import { DIRECTION_DELTA, type Direction } from './direction.js';

export interface GridMoverOptions {
  x: number;
  y: number;
  direction: Direction;
  /** Tiles per second. */
  speed: number;
}

/**
 * A character that moves tile by tile. `x`/`y` is the tile it occupies (its
 * destination while moving); `realX`/`realY` is its interpolated position in
 * tile units, which the renderer draws.
 */
export class GridMover {
  x: number;
  y: number;
  direction: Direction;
  speed: number;

  private fromX: number;
  private fromY: number;
  /** 0..1 progress from (fromX, fromY) to (x, y). 1 means standing still. */
  private progress = 1;
  /** Total tiles walked, used to drive walk animations. */
  distanceWalked = 0;

  constructor(options: GridMoverOptions) {
    this.x = this.fromX = options.x;
    this.y = this.fromY = options.y;
    this.direction = options.direction;
    this.speed = options.speed;
  }

  get isMoving(): boolean {
    return this.progress < 1;
  }

  get realX(): number {
    return this.fromX + (this.x - this.fromX) * this.progress;
  }

  get realY(): number {
    return this.fromY + (this.y - this.fromY) * this.progress;
  }

  /** Teleport to a tile, cancelling any movement in progress. */
  placeAt(x: number, y: number): void {
    this.x = this.fromX = x;
    this.y = this.fromY = y;
    this.progress = 1;
  }

  /**
   * Turn to face `direction` and, if the next tile is passable, start moving
   * into it. Returns true if a step started. Ignored while already moving.
   */
  tryStep(direction: Direction, passability: Passability): boolean {
    if (this.isMoving) return false;
    this.direction = direction;
    const { dx, dy } = DIRECTION_DELTA[direction];
    if (!passability.isPassable(this.x + dx, this.y + dy)) return false;
    this.fromX = this.x;
    this.fromY = this.y;
    this.x += dx;
    this.y += dy;
    this.progress = 0;
    return true;
  }

  /**
   * Advance by `dt` seconds. `nextDirection` is consulted every time the
   * mover is (or becomes) idle, so holding a direction walks continuously
   * without a pause between tiles.
   */
  update(dt: number, passability: Passability, nextDirection: () => Direction | null): void {
    let budget = dt * this.speed; // tiles of travel available this step
    for (;;) {
      if (!this.isMoving) {
        const dir = nextDirection();
        if (dir === null || !this.tryStep(dir, passability)) return;
      }
      const remaining = 1 - this.progress;
      if (budget < remaining) {
        this.progress += budget;
        this.distanceWalked += budget;
        return;
      }
      budget -= remaining;
      this.distanceWalked += remaining;
      this.progress = 1;
      this.fromX = this.x;
      this.fromY = this.y;
      if (budget <= 0) return;
    }
  }
}
