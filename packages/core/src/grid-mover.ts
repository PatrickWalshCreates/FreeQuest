import type { Passability } from './collision.js';
import { DIRECTION_DELTA, type Direction } from './direction.js';

/** Notifications from movement, used to fire touch triggers at the right moment. */
export interface MoveHooks {
  /** Finished a step onto (x, y). Called before the next step can start. */
  arrived?(x: number, y: number): void;
  /** Tried to step onto (x, y) but it was impassable. */
  bumped?(x: number, y: number): void;
}

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
 * tile units, which the renderer draws. A move is a step to a neighbour (also
 * diagonally) or a jump; jumps rise and fall (`jumpHeight`).
 *
 * How it moves and looks can be changed by move routes: walking through
 * things, keeping its facing, its walking and stepping animation, being
 * hidden, and looking like another character.
 */
export class GridMover {
  x: number;
  y: number;
  direction: Direction;
  speed: number;

  /** Moves ignore walls and characters. */
  through = false;
  /** Moving and turning don't change the facing. */
  facingFixed = false;
  /** The legs move while walking. */
  walkAnimation = true;
  /** The legs move even while standing. */
  stepAnimation = false;
  /** Not drawn (but still there: it blocks and can be talked to). */
  hidden = false;
  /** Looks like this character instead of its usual one (null: its usual one). */
  character: string | null = null;

  private fromX: number;
  private fromY: number;
  /** 0..1 progress from (fromX, fromY) to (x, y). 1 means standing still. */
  private progress = 1;
  /** Tiles of travel the current move takes (1 for a step, more for a long jump). */
  private moveLength = 1;
  /** Highest point of the current jump, in tiles (0 when walking). */
  private jumpPeak = 0;
  /** Total tiles walked (and stepped in place), used to drive walk animations. */
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

  /** Whether the legs should move now (walking with the animation on, or stepping in place). */
  get isAnimating(): boolean {
    return this.stepAnimation || (this.isMoving && this.walkAnimation && this.jumpPeak === 0);
  }

  get realX(): number {
    return this.fromX + (this.x - this.fromX) * this.progress;
  }

  get realY(): number {
    return this.fromY + (this.y - this.fromY) * this.progress;
  }

  /** How high above the ground it is mid-jump, in tiles (0 otherwise). */
  get jumpHeight(): number {
    if (!this.isMoving || this.jumpPeak === 0) return 0;
    return this.jumpPeak * 4 * this.progress * (1 - this.progress);
  }

  /** Teleport to a tile, cancelling any movement in progress. */
  placeAt(x: number, y: number): void {
    this.x = this.fromX = x;
    this.y = this.fromY = y;
    this.progress = 1;
    this.jumpPeak = 0;
  }

  /** Back to how characters move and look by default (a new page, a new map). */
  resetLooks(): void {
    this.through = false;
    this.facingFixed = false;
    this.walkAnimation = true;
    this.stepAnimation = false;
    this.hidden = false;
    this.character = null;
  }

  /** Turn to face `direction`, unless the facing is fixed. */
  face(direction: Direction): void {
    if (!this.facingFixed) this.direction = direction;
  }

  /**
   * Turn to face `direction` and, if the next tile is passable, start moving
   * into it. Returns true if a step started. Ignored while already moving.
   */
  tryStep(direction: Direction, passability: Passability, hooks?: MoveHooks): boolean {
    const { dx, dy } = DIRECTION_DELTA[direction];
    return this.tryMove(dx, dy, direction, passability, hooks);
  }

  /**
   * Start a step by (dx, dy), one tile each way at most (diagonals too),
   * facing `facing` first (null keeps the facing: stepping backward). A
   * diagonal step needs its tile free and one of the two tiles beside the
   * way. Returns true if it started.
   */
  tryMove(
    dx: number,
    dy: number,
    facing: Direction | null,
    passability: Passability,
    hooks?: MoveHooks,
  ): boolean {
    if (this.isMoving) return false;
    if (facing) this.face(facing);
    const tx = this.x + dx;
    const ty = this.y + dy;
    const open = (x: number, y: number) => this.through || passability.isPassable(x, y);
    const cross = (x: number, y: number, sx: number, sy: number) =>
      this.through || (passability.canCross?.(x, y, sx, sy) ?? true);
    const { x, y } = this;
    // A diagonal step goes round one corner or the other: either way's tile and sides must be open.
    const reachable =
      dx !== 0 && dy !== 0
        ? (open(x + dx, y) && cross(x, y, dx, 0) && cross(x + dx, y, 0, dy)) ||
          (open(x, y + dy) && cross(x, y, 0, dy) && cross(x, y + dy, dx, 0))
        : cross(x, y, dx, dy);
    if (!open(tx, ty) || !reachable) {
      hooks?.bumped?.(tx, ty);
      return false;
    }
    this.start(tx, ty, 1, 0);
    return true;
  }

  /**
   * Jump by (dx, dy) tiles (0, 0 jumps on the spot). It lands only on a
   * passable tile (any, when walking through things), facing the way it
   * jumps. Returns true if the jump started.
   */
  jump(dx: number, dy: number, passability: Passability): boolean {
    if (this.isMoving) return false;
    const tx = this.x + dx;
    const ty = this.y + dy;
    const landing = (dx === 0 && dy === 0) || this.through || passability.isPassable(tx, ty);
    if (!landing) return false;
    if (dx !== 0 || dy !== 0) {
      this.face(
        Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up',
      );
    }
    const distance = Math.hypot(dx, dy);
    this.start(tx, ty, Math.max(1, distance), 0.5 + 0.25 * distance);
    return true;
  }

  private start(tx: number, ty: number, length: number, peak: number): void {
    this.fromX = this.x;
    this.fromY = this.y;
    this.x = tx;
    this.y = ty;
    this.progress = 0;
    this.moveLength = length;
    this.jumpPeak = peak;
  }

  /** Time passing while standing: stepping in place keeps the legs going. */
  idle(dt: number): void {
    if (!this.isMoving && this.stepAnimation) this.distanceWalked += dt * this.speed;
  }

  /**
   * Advance by `dt` seconds. `nextDirection` is consulted every time the
   * mover is (or becomes) idle, so holding a direction walks continuously
   * without a pause between tiles.
   */
  update(
    dt: number,
    passability: Passability,
    nextDirection: () => Direction | null,
    hooks?: MoveHooks,
  ): void {
    let budget = dt * this.speed; // tiles of travel available this step
    for (;;) {
      if (!this.isMoving) {
        const dir = nextDirection();
        if (dir === null || !this.tryStep(dir, passability, hooks)) return;
      }
      const remaining = (1 - this.progress) * this.moveLength;
      if (budget < remaining) {
        this.progress += budget / this.moveLength;
        this.distanceWalked += budget;
        return;
      }
      budget -= remaining;
      this.distanceWalked += remaining;
      this.progress = 1;
      this.jumpPeak = 0;
      this.moveLength = 1;
      this.fromX = this.x;
      this.fromY = this.y;
      hooks?.arrived?.(this.x, this.y);
      if (budget <= 0) return;
    }
  }
}
