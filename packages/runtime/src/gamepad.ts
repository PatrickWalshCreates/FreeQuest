// Gamepads (M17 step 3): the Gamepad API's pads, read every frame and turned into
// the game's actions like keys. Inputs are named by id: "button:12" for a button,
// "axis:1-" / "axis:1+" for a stick pushed one way. Pads with the browser's
// standard layout (most Xbox, PlayStation and Switch pads) get buttons' names.
// DOM-free: the game passes in `navigator.getGamepads()`.
import type { Action } from '@freequest/core';
import type { HeldInputs } from './held-inputs.js';

/** Gamepad input id → action. Several inputs may map to the same action. */
export type PadBindings = Readonly<Record<string, Action>>;

export const DEFAULT_PAD_BINDINGS: PadBindings = {
  'button:12': 'up',
  'button:13': 'down',
  'button:14': 'left',
  'button:15': 'right',
  'axis:1-': 'up',
  'axis:1+': 'down',
  'axis:0-': 'left',
  'axis:0+': 'right',
  'button:0': 'confirm',
  'button:1': 'cancel',
  'button:2': 'menu',
  'button:9': 'menu',
};

/** How far a stick must lean (0–1) to count as pushed. */
export const STICK_THRESHOLD = 0.5;

/** The part of the Gamepad API the game reads. */
export interface PadLike {
  readonly index: number;
  readonly mapping: string;
  readonly buttons: readonly { readonly pressed: boolean }[];
  readonly axes: readonly number[];
}

/** The input ids a pad holds down now. */
export function padInputs(pad: PadLike): string[] {
  const ids: string[] = [];
  pad.buttons.forEach((b, i) => {
    if (b.pressed) ids.push(`button:${i}`);
  });
  pad.axes.forEach((value, i) => {
    if (value <= -STICK_THRESHOLD) ids.push(`axis:${i}-`);
    else if (value >= STICK_THRESHOLD) ids.push(`axis:${i}+`);
  });
  return ids;
}

const STANDARD_BUTTONS = [
  'A',
  'B',
  'X',
  'Y',
  'LB',
  'RB',
  'LT',
  'RT',
  'Back',
  'Start',
  'Left stick press',
  'Right stick press',
  'D-pad ↑',
  'D-pad ↓',
  'D-pad ←',
  'D-pad →',
  'Home',
];

const STANDARD_AXES: Readonly<Record<string, string>> = {
  '0-': 'Stick ←',
  '0+': 'Stick →',
  '1-': 'Stick ↑',
  '1+': 'Stick ↓',
  '2-': 'Right stick ←',
  '2+': 'Right stick →',
  '3-': 'Right stick ↑',
  '3+': 'Right stick ↓',
};

/** An input id as players read it: "button:0" → "A", "axis:1-" → "Stick ↑", "button:20" → "Button 20". */
export function padLabel(id: string): string {
  const button = /^button:(\d+)$/.exec(id);
  if (button) {
    const n = Number(button[1]);
    return STANDARD_BUTTONS[n] ?? `Button ${n}`;
  }
  const axis = /^axis:(\d+)([+-])$/.exec(id);
  if (axis) return STANDARD_AXES[`${axis[1]}${axis[2]}`] ?? `Axis ${axis[1]} ${axis[2]}`;
  return id;
}

export const isPadInput = (id: string): boolean => /^(button:\d+|axis:\d+[+-])$/.test(id);

/** Turns pads into actions; call `poll` once a frame. */
export class GamepadInput {
  /** Per pad: the inputs it held last frame. */
  private readonly previous = new Map<number, Set<string>>();
  private capture: ((id: string) => void) | null = null;

  constructor(
    private readonly held: HeldInputs,
    private bindings: PadBindings = DEFAULT_PAD_BINDINGS,
  ) {}

  setBindings(bindings: PadBindings): void {
    this.bindings = bindings;
    this.held.letGoAll('pad');
    // Inputs still held count as old: they don't act until pressed again.
  }

  /** Hand the next newly pressed pad input to `handler` instead of the game (rebinding). */
  captureNext(handler: (id: string) => void): void {
    this.capture = handler;
  }

  cancelCapture(): void {
    this.capture = null;
  }

  /** Whether any pad is connected (seen in the last poll). */
  get connected(): boolean {
    return this.previous.size > 0;
  }

  /** True if any pad pressed something this poll (to unlock audio, say). */
  poll(pads: readonly (PadLike | null)[]): boolean {
    let pressedAny = false;
    const seen = new Set<number>();
    for (const pad of pads) {
      if (!pad) continue;
      seen.add(pad.index);
      const before = this.previous.get(pad.index) ?? new Set<string>();
      const now = new Set(padInputs(pad));
      const prefix = `pad${pad.index}:`;
      for (const id of before) if (!now.has(id)) this.held.letGo(prefix + id);
      for (const id of now) {
        if (before.has(id)) continue;
        pressedAny = true;
        if (this.capture) {
          const handler = this.capture;
          this.capture = null;
          handler(id);
          continue;
        }
        const action = this.bindings[id];
        if (action) this.held.hold(prefix + id, action);
      }
      this.previous.set(pad.index, now);
    }
    // A pad that went away lets go of everything it held.
    for (const index of [...this.previous.keys()]) {
      if (seen.has(index)) continue;
      this.previous.delete(index);
      this.held.letGoAll(`pad${index}:`);
    }
    return pressedAny;
  }
}
