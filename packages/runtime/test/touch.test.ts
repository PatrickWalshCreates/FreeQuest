// M17 step 4: touch controls' rules.
import { describe, expect, it } from 'vitest';
import { TOUCH_STRIP, padDirection, touchReserve, wantsTouchControls } from '../src/touch.js';

describe('the touch direction pad', () => {
  it('points the way of the longer axis, nowhere near the centre', () => {
    expect(padDirection(0, -40, 66)).toBe('up');
    expect(padDirection(30, 10, 66)).toBe('right');
    expect(padDirection(-30, 29, 66)).toBe('left');
    expect(padDirection(5, 50, 66)).toBe('down');
    expect(padDirection(5, 5, 66)).toBeNull();
    // A thumb that slides off the pad still points (the pad keeps the pointer).
    expect(padDirection(-200, 0, 66)).toBe('left');
    expect(padDirection(10, 0, 0)).toBeNull();
  });
});

describe('room for touch controls', () => {
  it('keeps a strip under the game in portrait, none in landscape', () => {
    expect(touchReserve(390, 844)).toBe(TOUCH_STRIP.max);
    expect(touchReserve(390, 500)).toBe(Math.round(500 * TOUCH_STRIP.share));
    expect(touchReserve(320, 400)).toBe(TOUCH_STRIP.min);
    expect(touchReserve(844, 390)).toBe(0);
  });

  it('shows on phones and tablets by default, or as the game says', () => {
    expect(wantsTouchControls('auto', true)).toBe(true);
    expect(wantsTouchControls('auto', false)).toBe(false);
    expect(wantsTouchControls(false, true)).toBe(false);
    expect(wantsTouchControls(true, false)).toBe(true);
  });
});
