// The options screen: volumes and key bindings. Free of PixiJS so it can be
// tested in Node; `options-view.ts` draws the state. Every change is handed
// to `onChange` at once (the game saves it and applies it).
import { ACTIONS, type Action, type InputState } from '@freequest/core';
import type { MenuOption } from './battle-controller.js';
import {
  ACTION_NAMES,
  type GameOptions,
  VOLUME_STEPS,
  keyLabel,
  keysFor,
  rebind,
} from './options.js';
import { padLabel } from './gamepad.js';

type Screen = 'main' | 'controls' | 'gamepad';

export interface OptionsUiState {
  readonly screen: Screen;
  readonly title: string;
  readonly options: readonly MenuOption[];
  readonly cursor: number;
  /** While waiting for a key or button to bind: the action it's for. */
  readonly capturing: Action | null;
  /** What's being waited for: a key, or a gamepad input. */
  readonly capturingFrom: 'keyboard' | 'gamepad' | null;
  readonly message: string | null;
}

const MAIN = ['Music', 'Sound', 'Keyboard…', 'Gamepad…', 'Back'] as const;
const RESET = 'Reset to defaults';

/** A volume as a small bar: "■■■■■□□□□□". */
export function volumeBar(level: number): string {
  return '■'.repeat(level) + '□'.repeat(VOLUME_STEPS - level);
}

export class OptionsController {
  private screen: Screen = 'main';
  private readonly cursors = { main: 0, controls: 0, gamepad: 0 };
  private capture: Action | null = null;
  private feedback: string | null = null;
  private done = false;

  constructor(
    private current: GameOptions,
    private readonly defaults: GameOptions,
    private readonly onChange: (options: GameOptions) => void,
    /** Whether a gamepad is connected (the Gamepad screen says how to get one going). */
    private readonly padConnected: () => boolean = () => false,
  ) {}

  /** True once the player has backed out. */
  get isClosed(): boolean {
    return this.done;
  }

  get options(): GameOptions {
    return this.current;
  }

  private rows(): MenuOption[] {
    if (this.screen === 'main') {
      return MAIN.map((label) => ({
        label,
        detail:
          label === 'Music'
            ? volumeBar(this.current.music)
            : label === 'Sound'
              ? volumeBar(this.current.sound)
              : '',
        enabled: true,
      }));
    }
    const pad = this.screen === 'gamepad';
    return [
      ...ACTIONS.map((action) => ({
        label: ACTION_NAMES[action],
        detail:
          this.capture === action
            ? pad
              ? 'press a button…'
              : 'press a key…'
            : pad
              ? keysFor(this.current.pad, action).map(padLabel).join(', ')
              : keysFor(this.current.keys, action).map(keyLabel).join(' '),
        enabled: true,
      })),
      { label: RESET, enabled: true },
    ];
  }

  get state(): OptionsUiState {
    const pad = this.screen === 'gamepad';
    return {
      screen: this.screen,
      title: this.screen === 'main' ? 'Options' : pad ? 'Gamepad' : 'Keyboard',
      options: this.rows(),
      cursor: this.cursors[this.screen],
      capturing: this.capture,
      capturingFrom: this.capture ? (pad ? 'gamepad' : 'keyboard') : null,
      message: this.capture
        ? pad
          ? `Press a button or push the stick for ${ACTION_NAMES[this.capture]} (Esc keeps the old one).`
          : `Press a key for ${ACTION_NAMES[this.capture]} (Esc to keep the old one).`
        : (this.feedback ??
          (pad && !this.padConnected()
            ? 'No gamepad found: connect one and press any of its buttons.'
            : null)),
    };
  }

  private set(next: GameOptions): void {
    this.current = next;
    this.onChange(next);
  }

  private volume(which: 'music' | 'sound', by: number, wrap = false): void {
    let level = this.current[which] + by;
    if (wrap && level > VOLUME_STEPS) level = 0;
    level = Math.min(VOLUME_STEPS, Math.max(0, level));
    if (level !== this.current[which]) this.set({ ...this.current, [which]: level });
  }

  /** Actions from the bound keys and buttons. Ignored while waiting for a raw one. */
  update(input: InputState): void {
    if (this.done || this.capture) return;
    const pressed = (['confirm', 'cancel', 'up', 'down', 'left', 'right'] as const).some((a) =>
      input.justPressed(a),
    );
    if (pressed) this.feedback = null;
    const rows = this.rows();
    const screen = this.screen;
    if (input.justPressed('down')) this.cursors[screen] = (this.cursors[screen] + 1) % rows.length;
    if (input.justPressed('up')) {
      this.cursors[screen] = (this.cursors[screen] - 1 + rows.length) % rows.length;
    }
    const row = rows[this.cursors[screen]]?.label;
    if (screen === 'main' && (row === 'Music' || row === 'Sound')) {
      const which = row === 'Music' ? 'music' : 'sound';
      if (input.justPressed('right')) this.volume(which, 1);
      if (input.justPressed('left')) this.volume(which, -1);
      // Confirm steps up and wraps to silence, for players who don't think of ←/→.
      if (input.justPressed('confirm')) this.volume(which, 1, true);
    }
    if (input.justPressed('cancel')) {
      if (screen !== 'main') this.screen = 'main';
      else this.done = true;
      return;
    }
    if (!input.justPressed('confirm')) return;
    if (screen === 'main') {
      if (row === 'Keyboard…') this.screen = 'controls';
      else if (row === 'Gamepad…') this.screen = 'gamepad';
      else if (row === 'Back') this.done = true;
      return;
    }
    if (row === RESET) {
      if (screen === 'gamepad') {
        this.set({ ...this.current, pad: this.defaults.pad });
        this.feedback = 'Buttons are back to the defaults.';
      } else {
        this.set({ ...this.current, keys: this.defaults.keys });
        this.feedback = 'Keys are back to the defaults.';
      }
      return;
    }
    const action = ACTIONS[this.cursors[screen]];
    if (action) this.capture = action;
  }

  /**
   * The raw key pressed while capturing (`KeyboardEvent.code`). Escape keeps
   * the old binding; on the Gamepad screen any key does (it waits for a button).
   */
  keyPressed(code: string): void {
    const action = this.capture;
    if (!action) return;
    this.capture = null;
    if (code === 'Escape' || this.screen === 'gamepad') return;
    const result = rebind(this.current.keys, action, code);
    if ('problem' in result) {
      this.feedback = result.problem;
      return;
    }
    this.set({ ...this.current, keys: result.keys });
    this.feedback = `${ACTION_NAMES[action]}: ${keyLabel(code)}`;
  }

  /** The gamepad input pressed while capturing on the Gamepad screen ("button:0", "axis:1-"). */
  padPressed(id: string): void {
    const action = this.capture;
    if (!action || this.screen !== 'gamepad') return;
    this.capture = null;
    const result = rebind(this.current.pad, action, id, 'button');
    if ('problem' in result) {
      this.feedback = result.problem;
      return;
    }
    this.set({ ...this.current, pad: result.keys });
    this.feedback = `${ACTION_NAMES[action]}: ${padLabel(id)}`;
  }
}
