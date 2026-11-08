import type { Direction } from './direction.js';

/** Abstract input actions. Raw keys/buttons are mapped to these by the runtime. */
export type Action = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'menu';

export const ACTIONS: readonly Action[] = [
  'up',
  'down',
  'left',
  'right',
  'confirm',
  'cancel',
  'menu',
];

/** Read-only view of input that game logic consumes. */
export interface InputState {
  isDown(action: Action): boolean;
  /** True only during the first logic step after the action was pressed. */
  justPressed(action: Action): boolean;
  /** The held direction that was pressed most recently, or null. */
  heldDirection(): Direction | null;
}

const DIRECTION_ACTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

/**
 * Mutable input state. The runtime calls `press`/`release` from device events
 * and `endStep` after every fixed logic step.
 */
export class ActionState implements InputState {
  private readonly down = new Map<Action, number>();
  private readonly pressedThisStep = new Set<Action>();
  private counter = 0;

  press(action: Action): void {
    if (this.down.has(action)) return;
    this.down.set(action, ++this.counter);
    this.pressedThisStep.add(action);
  }

  release(action: Action): void {
    this.down.delete(action);
  }

  releaseAll(): void {
    this.down.clear();
  }

  endStep(): void {
    this.pressedThisStep.clear();
  }

  isDown(action: Action): boolean {
    return this.down.has(action);
  }

  justPressed(action: Action): boolean {
    return this.pressedThisStep.has(action);
  }

  heldDirection(): Direction | null {
    let best: Direction | null = null;
    let bestOrder = -1;
    for (const dir of DIRECTION_ACTIONS) {
      const order = this.down.get(dir);
      if (order !== undefined && order > bestOrder) {
        best = dir;
        bestOrder = order;
      }
    }
    return best;
  }
}
