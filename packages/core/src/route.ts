import type { MoveStep, RouteDirection, TurnDirection } from '@freequest/schema';
import type { Passability } from './collision.js';
import { DIRECTIONS, type Direction } from './direction.js';
import type { GridMover, MoveHooks } from './grid-mover.js';

const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

/** What a route needs to know about the world around the character it moves. */
export interface RouteSurroundings {
  readonly player: { readonly x: number; readonly y: number };
  readonly random: () => number;
}

export interface RouteOptions {
  /** Start again from the first step after the last. */
  readonly repeat: boolean;
  /** Skip a move that's blocked instead of trying it again until it's free. */
  readonly skipBlocked: boolean;
  /** Seconds to stand still after each move (page routes use the page's pause). */
  readonly pause?: number;
}

/** The way from `mover` toward the player along the longer gap (null when on the same tile). */
function towardPlayer(mover: GridMover, around: RouteSurroundings): Direction | null {
  const dx = around.player.x - mover.x;
  const dy = around.player.y - mover.y;
  if (dx === 0 && dy === 0) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** A route direction worked out now, for `mover`. */
export function resolveDirection(
  direction: RouteDirection | TurnDirection,
  mover: GridMover,
  around: RouteSurroundings,
): Direction {
  switch (direction) {
    case 'forward':
      return mover.direction;
    case 'around':
      return OPPOSITE[mover.direction];
    case 'random':
      return DIRECTIONS[Math.floor(around.random() * DIRECTIONS.length)] ?? mover.direction;
    case 'toward-player':
      return towardPlayer(mover, around) ?? mover.direction;
    case 'away-from-player': {
      const toward = towardPlayer(mover, around);
      return toward ? OPPOSITE[toward] : mover.direction;
    }
    default:
      return direction;
  }
}

/**
 * Walks a character (any `GridMover`) through route steps: one tile per move,
 * turns and speed changes at once, waits counted down in seconds. At most
 * one move starts per update, so a repeating route of only turns can't hang.
 */
export class RouteRunner {
  private index = 0;
  private waitLeft = 0;
  private moved = false;

  constructor(
    readonly steps: readonly MoveStep[],
    readonly options: RouteOptions,
  ) {}

  /** Finished: every step done (never, for a repeating route) and the character standing. */
  isDone(mover: GridMover): boolean {
    return (
      !this.options.repeat &&
      this.index >= this.steps.length &&
      this.waitLeft <= 0 &&
      !mover.isMoving
    );
  }

  update(
    dt: number,
    mover: GridMover,
    passability: Passability,
    around: RouteSurroundings,
    hooks?: MoveHooks,
  ): void {
    let time = dt;
    if (mover.isMoving) {
      mover.update(time, passability, () => null, hooks);
      if (mover.isMoving) return;
      time = 0;
    }
    if (this.moved) {
      this.moved = false;
      this.waitLeft = this.options.pause ?? 0;
    }
    // Each step is looked at once per update at most (a route of turns can't spin).
    for (let budget = this.steps.length + 1; budget > 0; budget--) {
      if (this.waitLeft > 0) {
        if (time < this.waitLeft) {
          this.waitLeft -= time;
          return;
        }
        time -= this.waitLeft;
        this.waitLeft = 0;
      }
      if (this.index >= this.steps.length) {
        if (!this.options.repeat || this.steps.length === 0) return;
        this.index = 0;
      }
      const step = this.steps[this.index];
      if (!step) return;
      switch (step.type) {
        case 'move': {
          const direction = resolveDirection(step.direction, mover, around);
          let offered = false;
          const { x, y } = mover;
          mover.update(
            time,
            passability,
            () => {
              if (offered) return null;
              offered = true;
              return direction;
            },
            hooks,
          );
          const started = mover.isMoving || mover.x !== x || mover.y !== y;
          if (started) {
            this.index++;
            this.moved = true;
            return;
          }
          if (!this.options.skipBlocked) return;
          this.index++;
          break;
        }
        case 'turn':
          mover.direction = resolveDirection(step.direction, mover, around);
          this.index++;
          break;
        case 'wait':
          this.waitLeft = step.seconds;
          this.index++;
          break;
        case 'speed':
          mover.speed = step.speed;
          this.index++;
          break;
      }
    }
  }
}
