// How battles move (M16 step 5): enemies entering, the acting enemy's hop,
// the pause as a turn starts, and damage numbers. Pure numbers, free of
// PixiJS, so the controller and the view share them and tests can check them.

/** Seconds before enemies start entering: the screen fades in from black first (0.3 s). */
export const ENTRANCE_DELAY = 0.3;
/** Seconds enemies take to fade and rise into place, after the delay. */
export const ENTRANCE_SECONDS = 0.6;
/** How far (pixels) enemies rise while entering. */
export const ENTRANCE_RISE = 12;
/** Seconds of quiet as each turn starts (its sound plays then). */
export const TURN_PAUSE_SECONDS = 0.3;
/** Seconds of the acting enemy's hop, and its height in pixels. */
export const ACT_HOP_SECONDS = 0.3;
export const ACT_HOP_HEIGHT = 8;
/** Seconds a damage number stays up, the share of it spent popping in, and its first scale. */
export const POPUP_SECONDS = 1.1;
export const POPUP_GROW = 0.12;
export const POPUP_START_SCALE = 1.6;

const clamp01 = (t: number) => Math.min(1, Math.max(0, t));

/** Enemies entering: `t` seconds since the battle opened → how visible, and how far below their place. */
export function entrance(t: number): { alpha: number; offsetY: number } {
  const p = clamp01((t - ENTRANCE_DELAY) / ENTRANCE_SECONDS);
  // Ease out: quick at first, settling into place.
  const eased = 1 - (1 - p) * (1 - p);
  return { alpha: eased, offsetY: Math.round((1 - eased) * ENTRANCE_RISE) };
}

/** The acting enemy's hop: `t` seconds into its action's line → pixels up (0 when done). */
export function actHop(t: number): number {
  if (t < 0 || t >= ACT_HOP_SECONDS) return 0;
  return Math.round(Math.sin((t / ACT_HOP_SECONDS) * Math.PI) * ACT_HOP_HEIGHT);
}

/**
 * A damage number `age` seconds after it appeared: it pops in large and
 * shrinks to size, rises a little, holds, then fades.
 */
export function popupMotion(age: number): { rise: number; alpha: number; scale: number } {
  const t = clamp01(age / POPUP_SECONDS);
  const grow = clamp01(age / (POPUP_SECONDS * POPUP_GROW));
  return {
    rise: Math.round(Math.min(1, t * 3) * 14),
    alpha: t < 0.75 ? 1 : Math.max(0, 1 - (t - 0.75) / 0.25),
    scale: POPUP_START_SCALE + (1 - POPUP_START_SCALE) * grow,
  };
}
