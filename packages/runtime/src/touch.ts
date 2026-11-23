// Touch controls' rules (M17 step 4): which way a thumb on the direction pad
// points, and how much of a phone's screen the controls take. DOM-free and
// tested; `touch-controls.ts` draws the pad and buttons and feeds the actions.
import type { Direction } from '@freequest/core';

/** Of the pad's radius, how far from the centre a thumb must be to point anywhere. */
export const PAD_DEAD_ZONE = 0.25;

/**
 * The direction a thumb at (`dx`, `dy`) from the pad's centre points (screen
 * axes: y grows downward), or null inside the dead zone. The longer axis wins,
 * so a slightly crooked thumb still walks straight.
 */
export function padDirection(dx: number, dy: number, radius: number): Direction | null {
  if (radius <= 0 || Math.hypot(dx, dy) < radius * PAD_DEAD_ZONE) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

/** The controls' strip under the game in portrait, in CSS pixels. */
export const TOUCH_STRIP = { min: 170, max: 250, share: 0.38 } as const;

/**
 * The height kept free under the game for the controls: a strip in portrait
 * (the game above it), none in landscape (the controls sit over the sides).
 */
export function touchReserve(viewWidth: number, viewHeight: number): number {
  if (viewHeight <= viewWidth) return 0;
  return Math.round(
    Math.min(TOUCH_STRIP.max, Math.max(TOUCH_STRIP.min, viewHeight * TOUCH_STRIP.share)),
  );
}

/**
 * Whether to show touch controls at the start: on devices whose main pointer
 * is a finger (phones, tablets). Others get them on their first touch.
 */
export function wantsTouchControls(setting: 'auto' | boolean, coarsePointer: boolean): boolean {
  return setting === 'auto' ? coarsePointer : setting;
}
