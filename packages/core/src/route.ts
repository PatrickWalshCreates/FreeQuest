import type { MoveStep, RouteDirection, TurnDirection } from '@freequest/schema';
import type { Passability } from './collision.js';
import { DIRECTIONS, DIRECTION_DELTA, type Direction } from './direction.js';
import type { GridMover, MoveHooks } from './grid-mover.js';

const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

const CLOCKWISE: Readonly<Record<Direction, Direction>> = {
  up: 'right',
  right: 'down',
  down: 'left',
  left: 'up',
};
const COUNTERCLOCKWISE: Readonly<Record<Direction, Direction>> = {
  up: 'left',
  left: 'down',
  down: 'right',
  right: 'up',
};

/** Diagonal moves: their steps across and down. */
const DIAGONALS: Readonly<Record<string, { dx: number; dy: number }>> = {
  'up-left': { dx: -1, dy: -1 },
  'up-right': { dx: 1, dy: -1 },
  'down-left': { dx: -1, dy: 1 },
  'down-right': { dx: 1, dy: 1 },
};

/** What a route needs to know about the world around the character it moves. */
export interface RouteSurroundings {
  readonly player: { readonly x: number; readonly y: number };
  readonly random: () => number;
  /** Plays a route's sound (silent without one). */
  readonly playSound?: (path: string) => void;
  /** Sets a switch for a route's switch step (ignored without one). */
  readonly setSwitch?: (id: string, value: boolean) => void;
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

/**
 * A route direction worked out now, for `mover` (one of the four ways;
 * diagonals and backward are moves of their own, see `RouteRunner`).
 */
export function resolveDirection(
  direction: RouteDirection | TurnDirection,
  mover: GridMover,
  around: RouteSurroundings,
): Direction {
  switch (direction) {
    case 'forward':
      return mover.direction;
    case 'around':
    case 'backward':
      return OPPOSITE[mover.direction];
    case 'clockwise':
      return CLOCKWISE[mover.direction];
    case 'counterclockwise':
      return COUNTERCLOCKWISE[mover.direction];
    case 'up-left':
    case 'down-left':
      return 'left';
    case 'up-right':
    case 'down-right':
      return 'right';
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
        case 'move':
        case 'jump': {
          const { x, y } = mover;
          if (!this.startMove(step, mover, passability, around, hooks)) {
            if (!this.options.skipBlocked) return;
            this.index++;
            break;
          }
          if (mover.isMoving) mover.update(time, passability, () => null, hooks);
          if (mover.isMoving || mover.x !== x || mover.y !== y || step.type === 'jump') {
            this.index++;
            this.moved = true;
            return;
          }
          this.index++;
          break;
        }
        case 'turn':
          mover.face(resolveDirection(step.direction, mover, around));
          this.index++;
          break;
        case 'character':
          mover.character = step.character;
          this.index++;
          break;
        case 'through':
          mover.through = step.on;
          this.index++;
          break;
        case 'fixFacing':
          mover.facingFixed = step.on;
          this.index++;
          break;
        case 'walkAnimation':
          mover.walkAnimation = step.on;
          this.index++;
          break;
        case 'stepAnimation':
          mover.stepAnimation = step.on;
          this.index++;
          break;
        case 'hidden':
          mover.hidden = step.on;
          this.index++;
          break;
        case 'sound':
          around.playSound?.(step.path);
          this.index++;
          break;
        case 'switch':
          around.setSwitch?.(step.switch, step.value);
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

  /** Start a move or jump step; false when it's blocked. */
  private startMove(
    step: Extract<MoveStep, { type: 'move' | 'jump' }>,
    mover: GridMover,
    passability: Passability,
    around: RouteSurroundings,
    hooks?: MoveHooks,
  ): boolean {
    if (step.type === 'jump') return mover.jump(step.x, step.y, passability);
    const diagonal = DIAGONALS[step.direction];
    if (diagonal) {
      const facing = resolveDirection(step.direction, mover, around);
      return mover.tryMove(diagonal.dx, diagonal.dy, facing, passability, hooks);
    }
    const direction = resolveDirection(step.direction, mover, around);
    const { dx, dy } = DIRECTION_DELTA[direction];
    // Backward keeps the facing; the others turn first.
    return mover.tryMove(
      dx,
      dy,
      step.direction === 'backward' ? null : direction,
      passability,
      hooks,
    );
  }
}
