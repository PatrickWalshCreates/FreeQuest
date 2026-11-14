// Zoom and scroll of a map canvas. Pure math so it can be tested: the UI
// keeps a Viewport in its state and passes screen coordinates in.

/**
 * Zoom steps offered by the zoom buttons, wheel and shortcuts. The small
 * ones let Fit show a whole big map (512 × 512 at 1/32); far out the map
 * view shows an overview rather than tiles.
 */
export const ZOOM_LEVELS = [1 / 32, 1 / 16, 1 / 8, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8] as const;

/** A zoom as the menu shows it: "25%", "12.5%", "3%". */
export function zoomLabel(zoom: number): string {
  const percent = zoom * 100;
  return `${percent >= 10 ? Math.round(percent * 10) / 10 : Math.round(percent)}%`;
}

/** Empty space allowed around the map when scrolling, in screen pixels. */
export const SCROLL_MARGIN = 64;

/**
 * `x`/`y` are the world (map pixel) coordinates shown at the canvas's top
 * left; a world point p appears at screen `(p - x) * zoom`.
 */
export interface Viewport {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

/** Sizes the viewport depends on: the map in world pixels and the canvas in screen pixels. */
export interface ViewportBounds {
  readonly mapWidth: number;
  readonly mapHeight: number;
  readonly viewWidth: number;
  readonly viewHeight: number;
}

/** The next zoom level up (`direction` 1) or down (-1) from `zoom`, or `zoom` at the ends. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  if (direction > 0) return ZOOM_LEVELS.find((z) => z > zoom + 1e-9) ?? zoom;
  return [...ZOOM_LEVELS].reverse().find((z) => z < zoom - 1e-9) ?? zoom;
}

/**
 * Keep the map reachable: on each axis, a map smaller than the canvas is
 * centered; a larger one scrolls no further than `SCROLL_MARGIN` past its
 * edges.
 */
export function clampViewport(view: Viewport, bounds: ViewportBounds): Viewport {
  const axis = (offset: number, mapSize: number, viewSize: number): number => {
    const visible = viewSize / view.zoom;
    const margin = SCROLL_MARGIN / view.zoom;
    if (mapSize + 2 * margin <= visible) return (mapSize - visible) / 2;
    return Math.min(Math.max(offset, -margin), mapSize + margin - visible);
  };
  return {
    zoom: view.zoom,
    x: axis(view.x, bounds.mapWidth, bounds.viewWidth),
    y: axis(view.y, bounds.mapHeight, bounds.viewHeight),
  };
}

/** The largest zoom level (at most 4×) that shows the whole map, centered. */
export function fitViewport(bounds: ViewportBounds): Viewport {
  const fits = (z: number) =>
    bounds.mapWidth * z + 2 * SCROLL_MARGIN <= bounds.viewWidth &&
    bounds.mapHeight * z + 2 * SCROLL_MARGIN <= bounds.viewHeight;
  const zoom = [...ZOOM_LEVELS].reverse().find((z) => z <= 4 && fits(z)) ?? ZOOM_LEVELS[0];
  return clampViewport({ zoom, x: 0, y: 0 }, bounds);
}

/** Change zoom keeping the world point under screen point (`sx`, `sy`) where it is. */
export function zoomAt(
  view: Viewport,
  zoom: number,
  sx: number,
  sy: number,
  bounds: ViewportBounds,
): Viewport {
  const wx = view.x + sx / view.zoom;
  const wy = view.y + sy / view.zoom;
  return clampViewport({ zoom, x: wx - sx / zoom, y: wy - sy / zoom }, bounds);
}

/** Scroll by a screen-pixel distance (positive moves the view right/down over the map). */
export function panBy(view: Viewport, dx: number, dy: number, bounds: ViewportBounds): Viewport {
  return clampViewport(
    { zoom: view.zoom, x: view.x + dx / view.zoom, y: view.y + dy / view.zoom },
    bounds,
  );
}

/** World pixel coordinates of a screen point. */
export function screenToWorld(view: Viewport, sx: number, sy: number): { x: number; y: number } {
  return { x: view.x + sx / view.zoom, y: view.y + sy / view.zoom };
}

/** The map cell under a screen point, or null outside the map. */
export function screenToTile(
  view: Viewport,
  sx: number,
  sy: number,
  tileWidth: number,
  tileHeight: number,
  mapWidth: number,
  mapHeight: number,
): { x: number; y: number } | null {
  const world = screenToWorld(view, sx, sy);
  const x = Math.floor(world.x / tileWidth);
  const y = Math.floor(world.y / tileHeight);
  return x >= 0 && y >= 0 && x < mapWidth && y < mapHeight ? { x, y } : null;
}
