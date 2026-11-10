/** Pixels a whole-step scale may overshoot the space by (clipped, never noticed). */
export const SCALE_SLACK = 2;

/**
 * The whole-number scale that fits a game of `width`×`height` in a space of
 * `viewWidth`×`viewHeight` (at least 1). Whole steps keep pixel art crisp; a
 * couple of pixels of slack stop a window that's a hair too small (window
 * borders, rounding) from halving the picture.
 */
export function fitScale(
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
): number {
  const fits = (scale: number) =>
    width * scale <= viewWidth + SCALE_SLACK && height * scale <= viewHeight + SCALE_SLACK;
  let scale = 1;
  while (fits(scale + 1)) scale += 1;
  return scale;
}
