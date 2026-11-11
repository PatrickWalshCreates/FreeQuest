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

export interface OptionsUiState {
  readonly screen: 'main' | 'controls';
  readonly title: string;
  readonly options: readonly MenuOption[];
  readonly cursor: number;
  /** While waiting for a key to bind: the action it's for. */
  readonly capturing: Action | null;
  readonly message: string | null;
}

const MAIN = ['Music', 'Sound', 'Controls…', 'Back'] as const;
const RESET = 'Reset to defaults';

/** A volume as a small bar: "■■■■■□□□□□". */
export function volumeBar(level: number): string {
  return '■'.repeat(level) + '□'.repeat(VOLUME_STEPS - level);
}

export class OptionsController {
  private screen: 'main' | 'controls' = 'main';
  private readonly cursors = { main: 0, controls: 0 };
  private capture: Action | null = null;
  private feedback: string | null = null;
  private done = false;

  constructor(
    private current: GameOptions,
    private readonly defaults: GameOptions,
    private readonly onChange: (options: GameOptions) => void,
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
    return [
      ...ACTIONS.map((action) => ({
        label: ACTION_NAMES[action],
        detail:
          this.capture === action
            ? 'press a key…'
            : keysFor(this.current.keys, action).map(keyLabel).join(' '),
        enabled: true,
      })),
      { label: RESET, enabled: true },
    ];
  }

  get state(): OptionsUiState {
    return {
      screen: this.screen,
      title: this.screen === 'main' ? 'Options' : 'Controls',
      options: this.rows(),
      cursor: this.cursors[this.screen],
      capturing: this.capture,
      message: this.capture
        ? `Press a key for ${ACTION_NAMES[this.capture]} (Esc to keep the old one).`
        : this.feedback,
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

  /** Actions from the bound keys. Ignored while waiting for a raw key (see `keyPressed`). */
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
      if (screen === 'controls') this.screen = 'main';
      else this.done = true;
      return;
    }
    if (!input.justPressed('confirm')) return;
    if (screen === 'main') {
      if (row === 'Controls…') this.screen = 'controls';
      else if (row === 'Back') this.done = true;
      return;
    }
    if (row === RESET) {
      this.set({ ...this.current, keys: this.defaults.keys });
      this.feedback = 'Keys are back to the defaults.';
      return;
    }
    const action = ACTIONS[this.cursors.controls];
    if (action) this.capture = action;
  }

  /** The raw key pressed while capturing (`KeyboardEvent.code`). Escape keeps the old keys. */
  keyPressed(code: string): void {
    const action = this.capture;
    if (!action) return;
    this.capture = null;
    if (code === 'Escape') return;
    const result = rebind(this.current.keys, action, code);
    if ('problem' in result) {
      this.feedback = result.problem;
      return;
    }
    this.set({ ...this.current, keys: result.keys });
    this.feedback = `${ACTION_NAMES[action]}: ${keyLabel(code)}`;
  }
}
