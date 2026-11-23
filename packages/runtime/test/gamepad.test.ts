// M17 step 3: gamepads turned into actions, beside the keyboard.
import { ActionState } from '@freequest/core';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAD_BINDINGS,
  GamepadInput,
  HeldInputs,
  type PadLike,
  padInputs,
  padLabel,
} from '../src/index.js';

/** A standard pad (17 buttons, 4 axes) with `pressed` buttons and stick `axes`. */
function pad(pressed: number[] = [], axes: number[] = [0, 0, 0, 0], index = 0): PadLike {
  return {
    index,
    mapping: 'standard',
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
    axes,
  };
}

function setup() {
  const input = new ActionState();
  const held = new HeldInputs(input);
  const pads = new GamepadInput(held);
  return { input, held, pads };
}

describe('gamepad inputs', () => {
  it('reads buttons and sticks pushed past the threshold', () => {
    expect(padInputs(pad([0, 12]))).toEqual(['button:0', 'button:12']);
    expect(padInputs(pad([], [0.2, -0.9, 0, 0.6]))).toEqual(['axis:1-', 'axis:3+']);
  });

  it('names inputs for players', () => {
    expect(padLabel('button:0')).toBe('A');
    expect(padLabel('button:9')).toBe('Start');
    expect(padLabel('button:12')).toBe('D-pad ↑');
    expect(padLabel('axis:0-')).toBe('Stick ←');
    expect(padLabel('button:21')).toBe('Button 21');
    expect(padLabel('axis:7+')).toBe('Axis 7 +');
  });

  it('presses actions once when pushed and releases them when let go', () => {
    const { input, pads } = setup();
    expect(pads.poll([pad([0])])).toBe(true);
    expect(input.justPressed('confirm')).toBe(true);
    input.endStep();
    expect(pads.poll([pad([0])])).toBe(false);
    expect(input.justPressed('confirm')).toBe(false);
    expect(input.isDown('confirm')).toBe(true);
    pads.poll([pad()]);
    expect(input.isDown('confirm')).toBe(false);
    pads.poll([pad([], [0, -1, 0, 0])]);
    expect(input.heldDirection()).toBe('up');
    expect(pads.connected).toBe(true);
  });

  it('shares actions with the keyboard: letting go of one keeps the other’s', () => {
    const { input, held, pads } = setup();
    held.hold('key:ArrowUp', 'up');
    pads.poll([pad([12])]);
    held.letGo('key:ArrowUp');
    expect(input.isDown('up')).toBe(true);
    pads.poll([pad()]);
    expect(input.isDown('up')).toBe(false);
  });

  it('lets go of everything a pad held when it’s unplugged', () => {
    const { input, pads } = setup();
    pads.poll([pad([1]), pad([12], undefined, 1)]);
    pads.poll([null, pad([12], undefined, 1)]);
    expect(input.isDown('cancel')).toBe(false);
    expect(input.isDown('up')).toBe(true);
    pads.poll([]);
    expect(input.isDown('up')).toBe(false);
    expect(pads.connected).toBe(false);
  });

  it('hands the next new press to a capture, and uses new bindings', () => {
    const { input, pads } = setup();
    pads.poll([pad([0])]);
    const got: string[] = [];
    pads.captureNext((id) => got.push(id));
    pads.poll([pad([0, 3])]);
    expect(got).toEqual(['button:3']);
    pads.setBindings({ ...DEFAULT_PAD_BINDINGS, 'button:3': 'menu' });
    // Still held from before: nothing until pressed again.
    expect(input.isDown('confirm')).toBe(false);
    pads.poll([pad([0, 3])]);
    expect(input.isDown('menu')).toBe(false);
    pads.poll([pad()]);
    pads.poll([pad([3])]);
    expect(input.isDown('menu')).toBe(true);
  });
});
