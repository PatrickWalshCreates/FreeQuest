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

/** Feed keyboard events into an ActionState. Returns a function that removes the listeners. */
export function bindKeyboard(
  target: Window,
  input: ActionState,
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
): () => void {
  // Keys currently held per action, so releasing one of two keys bound to
  // the same action (e.g. ArrowUp and W) doesn't release the action.
  const held = new Map<Action, Set<string>>();

  const onDown = (e: KeyboardEvent) => {
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
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}
