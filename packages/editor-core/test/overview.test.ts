import { EMPTY_TILE, type GameMap } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { averageTileColors, overviewPixels } from '../src/index.js';

/** A 4 × 2 image of two 2 × 2 tiles: solid red, and half transparent green on transparent. */
function image(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(4 * 2 * 4);
  const set = (x: number, y: number, rgba: number[]) => px.set(rgba, (y * 4 + x) * 4);
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ] as const)
    set(x, y, [255, 0, 0, 255]);
  set(2, 0, [0, 200, 0, 255]);
  set(3, 1, [0, 100, 0, 255]);
  return px;
}

describe('the map overview', () => {
  it('averages each tile, weighted by alpha', () => {
    const [red, green] = averageTileColors(image(), 4, 2, 2, 2, 2);
    expect(red).toEqual({ r: 255, g: 0, b: 0, a: 255 });
    expect(green).toEqual({ r: 0, g: 150, b: 0, a: 128 });
  });

  it('blends the visible layers over the floor, one pixel per cell', () => {
    const colors = [
      { r: 255, g: 0, b: 0, a: 255 },
      { r: 0, g: 200, b: 0, a: 128 },
    ];
    const map = {
      width: 2,
      height: 1,
      layers: [
        { name: 'ground', data: [[0, EMPTY_TILE]] },
        { name: 'upper', data: [[1, 1]] },
      ],
    } as unknown as GameMap;
    const floor = { r: 0, g: 0, b: 0, a: 255 };
    const px = Array.from(overviewPixels(map, colors, { floor }));
    // Red under half-strength green; floor under half-strength green.
    expect(px).toEqual([127, 100, 0, 255, 0, 100, 0, 255]);
    const hidden = Array.from(overviewPixels(map, colors, { floor, hiddenLayers: new Set([1]) }));
    expect(hidden).toEqual([255, 0, 0, 255, 0, 0, 0, 255]);
  });
});
