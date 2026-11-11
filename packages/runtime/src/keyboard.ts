import type { Action, ActionState } from '@freequest/core';

/** KeyboardEvent.code → action. Several keys may map to the same action. */
export type KeyBindings = Readonly<Record<string, Action>>;

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  Enter: 'confirm',
  Space: 'confirm',
  KeyZ: 'confirm',
  Escape: 'cancel',
  Backspace: 'cancel',
  KeyX: 'cancel',
  KeyC: 'menu',
  Tab: 'menu',
};

/** The keyboard feeding the game: bindings can change while it runs. */
export interface KeyboardInput {
  setBindings(bindings: KeyBindings): void;
  /** Hand the next key press (its `code`) to `handler` instead of the game (rebinding). */
  captureNext(handler: (code: string) => void): void;
  /** Remove the listeners. */
  dispose(): void;
}

/** Feed keyboard events into an ActionState. */
export function bindKeyboard(
  target: Window,
  input: ActionState,
  initial: KeyBindings = DEFAULT_KEY_BINDINGS,
): KeyboardInput {
  let bindings = initial;
  let capture: ((code: string) => void) | null = null;
  // Keys currently held per action, so releasing one of two keys bound to
  // the same action (e.g. ArrowUp and W) doesn't release the action.
  const held = new Map<Action, Set<string>>();

  const onDown = (e: KeyboardEvent) => {
    if (capture && !e.repeat) {
      e.preventDefault();
      const handler = capture;
      capture = null;
      handler(e.code);
      return;
    }
    const action = bindings[e.code];
    if (!action) return;
    e.preventDefault();
    let codes = held.get(action);
    if (!codes) held.set(action, (codes = new Set()));
    codes.add(e.code);
    input.press(action);
  };
  const onUp = (e: KeyboardEvent) => {
    const action = bindings[e.code];
    if (!action) return;
    e.preventDefault();
    const codes = held.get(action);
    codes?.delete(e.code);
    if (!codes || codes.size === 0) input.release(action);
  };
  const onBlur = () => {
    held.clear();
    input.releaseAll();
  };

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return {
    setBindings(next) {
      // Keys held under the old bindings would never be released: start clean.
      bindings = next;
      held.clear();
      input.releaseAll();
    },
    captureNext(handler) {
      capture = handler;
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
