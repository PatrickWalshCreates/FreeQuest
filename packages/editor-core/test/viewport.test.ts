import { describe, expect, it } from 'vitest';
import {
  SCROLL_MARGIN,
  type ViewportBounds,
  ZOOM_LEVELS,
  zoomLabel,
  clampViewport,
  fitViewport,
  panBy,
  screenToTile,
  screenToWorld,
  stepZoom,
  zoomAt,
} from '../src/index.js';

// A 20×15 map of 32px tiles in an 800×600 canvas.
const bounds: ViewportBounds = { mapWidth: 640, mapHeight: 480, viewWidth: 800, viewHeight: 600 };

describe('viewport', () => {
  it('steps through zoom levels and stops at the ends', () => {
    expect(stepZoom(1, 1)).toBe(1.5);
    expect(stepZoom(1, -1)).toBe(0.75);
    expect(stepZoom(1.2, -1)).toBe(1);
    expect(stepZoom(ZOOM_LEVELS[0], -1)).toBe(ZOOM_LEVELS[0]);
    expect(stepZoom(8, 1)).toBe(8);
    expect(stepZoom(0.25, -1)).toBe(0.125);
  });

  it('labels zooms for the menu', () => {
    expect([1 / 32, 1 / 8, 0.25, 1.5].map(zoomLabel)).toEqual(['3%', '12.5%', '25%', '150%']);
  });

  it('fits a 512 × 512 map of 32 px tiles by zooming far out', () => {
    const big = { mapWidth: 512 * 32, mapHeight: 512 * 32, viewWidth: 800, viewHeight: 600 };
    expect(fitViewport(big).zoom).toBe(1 / 32);
  });

  it('fits the whole map, centered', () => {
    // 480 map px + 2 margins don't fit in 600 at 1×; they do in 620.
    expect(fitViewport(bounds).zoom).toBe(0.75);
    const view = fitViewport({ ...bounds, viewHeight: 620 });
    expect(view.zoom).toBe(1);
    // 640 map px in 800 view px: 80px of empty space on each side.
    expect(view.x).toBe(-80);
    expect(view.y).toBe(-70);
    expect(fitViewport({ ...bounds, viewWidth: 3000, viewHeight: 3000 }).zoom).toBe(4);
    expect(fitViewport({ ...bounds, viewWidth: 10, viewHeight: 10 }).zoom).toBe(ZOOM_LEVELS[0]);
  });

  it('keeps a zoomed-in map within a margin of its edges', () => {
    const zoomed = { zoom: 4, x: 0, y: 0 };
    expect(clampViewport({ ...zoomed, x: -1000 }, bounds).x).toBe(-SCROLL_MARGIN / 4);
    // Visible width is 200 world px; the right edge plus margin is 640 + 16.
    expect(clampViewport({ ...zoomed, x: 10_000 }, bounds).x).toBe(640 + 16 - 200);
    expect(clampViewport({ ...zoomed, x: 100 }, bounds).x).toBe(100);
  });

  it('zooms around the pointer', () => {
    const view = { zoom: 2, x: 100, y: 100 };
    const before = screenToWorld(view, 200, 150);
    const after = zoomAt(view, 4, 200, 150, bounds);
    expect(after.zoom).toBe(4);
    expect(screenToWorld(after, 200, 150)).toEqual(before);
  });

  it('pans in screen pixels', () => {
    const view = { zoom: 2, x: 100, y: 100 };
    expect(panBy(view, 40, -20, bounds)).toEqual({ zoom: 2, x: 120, y: 90 });
  });

  it('finds the tile under a screen point', () => {
    const view = { zoom: 2, x: -10, y: 0 };
    expect(screenToTile(view, 20, 0, 32, 32, 20, 15)).toEqual({ x: 0, y: 0 });
    expect(screenToTile(view, 19, 0, 32, 32, 20, 15)).toBeNull();
    expect(screenToTile(view, 20 + 64 * 3, 64 * 2 + 63, 32, 32, 20, 15)).toEqual({ x: 3, y: 2 });
    expect(screenToTile({ zoom: 1, x: 0, y: 0 }, 640, 0, 32, 32, 20, 15)).toBeNull();
  });
});
