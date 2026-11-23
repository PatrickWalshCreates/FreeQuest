// What's holding each action down: keys and gamepad buttons together. An action
// is pressed when the first thing holds it and released only when the last one
// lets go, so letting go of a key while a pad's d-pad still holds Up (or one of
// two keys bound to Up) keeps it down. DOM-free.
import type { Action, ActionState } from '@freequest/core';

export class HeldInputs {
  /** Input id (a key code, "pad0:button:12"…) → the action it holds. */
  private readonly holding = new Map<string, Action>();

  constructor(private readonly input: ActionState) {}

  hold(id: string, action: Action): void {
    const before = this.holding.get(id);
    if (before === action) return;
    if (before) this.letGo(id);
    this.holding.set(id, action);
    this.input.press(action);
  }

  letGo(id: string): void {
    const action = this.holding.get(id);
    if (!action) return;
    this.holding.delete(id);
    if (![...this.holding.values()].includes(action)) this.input.release(action);
  }

  /** Let go of every input whose id starts with `prefix` (all of them by default). */
  letGoAll(prefix = ''): void {
    for (const id of [...this.holding.keys()]) if (id.startsWith(prefix)) this.letGo(id);
  }

  /** Whether `id` holds an action now. */
  has(id: string): boolean {
    return this.holding.has(id);
  }
}
