/** Pixels a whole-step scale may overshoot the space by (clipped, never noticed). */
export const SCALE_SLACK = 2;

/**
 * The whole-number scale that fits a game of `width`×`height` in a space of
 * `viewWidth`×`viewHeight`. Whole steps keep pixel art crisp; a couple of
 * pixels of slack stop a window that's a hair too small (window borders,
 * rounding) from halving the picture. A space smaller than the game itself (a
 * phone held upright) gets the fraction that fits: a little softer, but whole.
 */
export function fitScale(
  width: number,
  height: number,
  viewWidth: number,
  viewHeight: number,
): number {
  const fits = (scale: number) =>
    width * scale <= viewWidth + SCALE_SLACK && height * scale <= viewHeight + SCALE_SLACK;
  if (!fits(1)) {
    const fraction = Math.min(viewWidth / width, viewHeight / height);
    return fraction > 0 ? fraction : 1;
  }
  let scale = 1;
  while (fits(scale + 1)) scale += 1;
  return scale;
}

/** The most device pixels per game pixel sharp text is drawn at (a cap on the canvas's size). */
export const MAX_RENDER_RESOLUTION = 8;

/**
 * Device pixels per game pixel the game renders at. Normally 1: the canvas is
 * the game's own size and the browser enlarges it, pixels and text alike.
 * With sharp text, the screen's own resolution (the whole-step `scale` times
 * the display's pixel ratio), so text is drawn for the screen while the art,
 * sampled nearest, looks just as it did.
 */
export function renderResolution(scale: number, pixelRatio: number, sharpText: boolean): number {
  if (!sharpText) return 1;
  const ratio = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return Math.min(MAX_RENDER_RESOLUTION, Math.max(1, scale * ratio));
}
