// The player's options: music and sound volume, and which keys do what.
// Kept per game, apart from save slots, in the same storage (localStorage,
// or files in the desktop player). DOM-free and tested.
import { ACTIONS, type Action } from '@freequest/core';
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from './keyboard.js';
import type { KeyValueStorage } from './save-store.js';

/** Volume levels run from 0 (silent) to this. */
export const VOLUME_STEPS = 10;

export interface GameOptions {
  /** 0..VOLUME_STEPS */
  readonly music: number;
  /** 0..VOLUME_STEPS */
  readonly sound: number;
  /** KeyboardEvent.code → action. */
  readonly keys: KeyBindings;
}

export function defaultOptions(keys: KeyBindings = DEFAULT_KEY_BINDINGS): GameOptions {
  return { music: 5, sound: 7, keys };
}

/** A volume level as the 0..1 gain the audio player uses. */
export function volumeGain(level: number): number {
  return Math.min(Math.max(level, 0), VOLUME_STEPS) / VOLUME_STEPS;
}

/** The keys bound to an action, in the order they were bound. */
export function keysFor(keys: KeyBindings, action: Action): string[] {
  return Object.entries(keys)
    .filter(([, a]) => a === action)
    .map(([code]) => code);
}

/** What each action is called on the options screen. */
export const ACTION_NAMES: Readonly<Record<Action, string>> = {
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  confirm: 'Confirm / talk',
  cancel: 'Cancel',
  menu: 'Menu',
};

const KEY_NAMES: Readonly<Record<string, string>> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  ShiftLeft: 'Left Shift',
  ShiftRight: 'Right Shift',
  ControlLeft: 'Left Ctrl',
  ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt',
  AltRight: 'Right Alt',
};

/** A key code as players read it: "KeyW" → "W", "Digit1" → "1", "ArrowUp" → "↑". */
export function keyLabel(code: string): string {
  if (KEY_NAMES[code]) return KEY_NAMES[code];
  const match = /^(?:Key|Digit|Numpad)(.+)$/.exec(code);
  return match?.[1] ?? code;
}

/**
 * Make `code` the key for `action` (instead of its old keys). A key another
 * action used moves over, unless it's that action's only key: every action
 * always keeps at least one key, so the game can't become unplayable.
 */
export function rebind(
  keys: KeyBindings,
  action: Action,
  code: string,
): { readonly keys: KeyBindings } | { readonly problem: string } {
  const owner = keys[code];
  if (owner && owner !== action && keysFor(keys, owner).length === 1) {
    return {
      problem: `${keyLabel(code)} is the only key for ${ACTION_NAMES[owner]}: give it another first.`,
    };
  }
  const next: Record<string, Action> = {};
  for (const [c, a] of Object.entries(keys)) {
    if (a !== action && c !== code) next[c] = a;
  }
  next[code] = action;
  return { keys: next };
}

const isAction = (value: unknown): value is Action => ACTIONS.includes(value as Action);

/** Reads and writes one game's options. Damaged or missing data falls back to the defaults. */
export class OptionsStore {
  private readonly key: string;

  constructor(
    private readonly storage: KeyValueStorage,
    gameId: string,
    private readonly defaults: GameOptions = defaultOptions(),
  ) {
    this.key = `freequest:game:${gameId}:options`;
  }

  load(): GameOptions {
    let data: unknown;
    try {
      data = JSON.parse(this.storage.getItem(this.key) ?? 'null');
    } catch {
      return this.defaults;
    }
    if (typeof data !== 'object' || data === null) return this.defaults;
    const d = data as Record<string, unknown>;
    const level = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= VOLUME_STEPS ? v : fallback;
    const keys: Record<string, Action> = {};
    if (typeof d['keys'] === 'object' && d['keys'] !== null) {
      for (const [code, action] of Object.entries(d['keys'] as Record<string, unknown>)) {
        if (isAction(action)) keys[code] = action;
      }
    }
    // Keys only count if every action still has one; otherwise start over from the defaults.
    const complete = ACTIONS.every((a) => keysFor(keys, a).length > 0);
    return {
      music: level(d['music'], this.defaults.music),
      sound: level(d['sound'], this.defaults.sound),
      keys: complete ? keys : this.defaults.keys,
    };
  }

  save(options: GameOptions): void {
    this.storage.setItem(this.key, JSON.stringify(options));
  }
}
