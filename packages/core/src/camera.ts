export interface CameraInput {
  /** Point to center on, in pixels. */
  focusX: number;
  focusY: number;
  viewWidth: number;
  viewHeight: number;
  mapWidth: number;
  mapHeight: number;
}

/**
 * Top-left of the view in map pixels: centered on the focus, clamped so the
 * view never shows outside the map. On an axis where the map is smaller than
 * the view, the map is centered instead.
 */
export function computeCamera(input: CameraInput): { x: number; y: number } {
  return {
    x: clampAxis(input.focusX, input.viewWidth, input.mapWidth),
    y: clampAxis(input.focusY, input.viewHeight, input.mapHeight),
  };
}

function clampAxis(focus: number, view: number, map: number): number {
  if (map <= view) return (map - view) / 2;
  return Math.min(Math.max(focus - view / 2, 0), map - view);
}
