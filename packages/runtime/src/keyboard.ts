import type { Action } from '@freequest/core';
import type { HeldInputs } from './held-inputs.js';

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
  /** Stop waiting for a key (the capture was answered some other way). */
  cancelCapture(): void;
  /** Remove the listeners. */
  dispose(): void;
}

/** Feed keyboard events into the game's actions (through `held`, shared with gamepads). */
export function bindKeyboard(
  target: Window,
  held: HeldInputs,
  initial: KeyBindings = DEFAULT_KEY_BINDINGS,
): KeyboardInput {
  let bindings = initial;
  let capture: ((code: string) => void) | null = null;
  const id = (code: string) => `key:${code}`;

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
    held.hold(id(e.code), action);
  };
  const onUp = (e: KeyboardEvent) => {
    if (!bindings[e.code] && !held.has(id(e.code))) return;
    e.preventDefault();
    held.letGo(id(e.code));
  };
  const onBlur = () => held.letGoAll('key:');

  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return {
    setBindings(next) {
      // Keys held under the old bindings would never be released: start clean.
      bindings = next;
      held.letGoAll('key:');
    },
    captureNext(handler) {
      capture = handler;
    },
    cancelCapture() {
      capture = null;
    },
    dispose() {
      target.removeEventListener('keydown', onDown);
      target.removeEventListener('keyup', onUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}
