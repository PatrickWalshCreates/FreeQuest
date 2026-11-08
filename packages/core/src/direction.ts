import type { Direction } from '@freequest/schema';

export type { Direction };

export const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];

export const DIRECTION_DELTA: Readonly<
  Record<Direction, { readonly dx: number; readonly dy: number }>
> = {
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
  up: { dx: 0, dy: -1 },
};
