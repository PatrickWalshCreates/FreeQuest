import { describe, expect, it } from 'vitest';
import { CHUNK_SIZE, chunkCount, chunkTiles, chunksInView, inRange } from '../src/index.js';

describe('map chunks', () => {
  it('counts chunks, rounding a partial one up', () => {
    expect(CHUNK_SIZE).toBe(16);
    expect(chunkCount(20, 15)).toEqual({ x: 2, y: 1 });
    expect(chunkCount(512, 512)).toEqual({ x: 32, y: 32 });
  });

  it('finds the chunks a view touches, with a margin, clamped to the map', () => {
    // A 480 × 352 screen of 32 px tiles at the top left of a 512 × 512 map.
    const view = { x: 0, y: 0, width: 480, height: 352 };
    expect(chunksInView(view, 32, 32, 512, 512, 0)).toEqual({ x0: 0, y0: 0, x1: 0, y1: 0 });
    expect(chunksInView(view, 32, 32, 512, 512)).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
    // Straddling a chunk border at tile 16 (512 px).
    expect(chunksInView({ x: 500, y: 0, width: 40, height: 10 }, 32, 32, 512, 512, 0)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
    });
    // The far corner of a small map stays inside it.
    expect(chunksInView({ x: 600, y: 400, width: 480, height: 352 }, 32, 32, 20, 15)).toEqual({
      x0: 0,
      y0: 0,
      x1: 1,
      y1: 0,
    });
    expect(chunksInView({ x: -2000, y: 0, width: 100, height: 100 }, 32, 32, 20, 15, 0)).toBeNull();
  });

  it('says what a chunk covers, and whether it is in a range', () => {
    expect(chunkTiles(1, 0, 20, 15)).toEqual({ x0: 16, y0: 0, x1: 19, y1: 14 });
    const range = { x0: 1, y0: 1, x1: 2, y1: 3 };
    expect([inRange(range, 1, 1), inRange(range, 3, 1), inRange(null, 0, 0)]).toEqual([
      true,
      false,
      false,
    ]);
  });
});
