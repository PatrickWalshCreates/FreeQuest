// Maps are drawn in square chunks of tiles, built only near what's on
// screen, so a big map costs what the screen shows rather than its whole
// area (one sprite per tile used about 1 KB each: 320 MB for 512 × 512).
// This is the math, shared by the game and the editor; they do the drawing.

/** Tiles along each side of a chunk. */
export const CHUNK_SIZE = 16;

/** A rectangle of chunks, inclusive: chunk (cx, cy) covers tiles cx·16 … cx·16 + 15. */
export interface ChunkRange {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

/** How many chunks across and down a map has. */
export function chunkCount(mapWidth: number, mapHeight: number): { x: number; y: number } {
  return { x: Math.ceil(mapWidth / CHUNK_SIZE), y: Math.ceil(mapHeight / CHUNK_SIZE) };
}

/**
 * The chunks a view of the map touches, widened by `margin` chunks each way
 * (so walking or scrolling a little never shows an unbuilt chunk), clamped
 * to the map. The view is in map pixels. Null when it doesn't touch the map.
 */
export function chunksInView(
  view: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  tileWidth: number,
  tileHeight: number,
  mapWidth: number,
  mapHeight: number,
  margin = 1,
): ChunkRange | null {
  const count = chunkCount(mapWidth, mapHeight);
  const cw = tileWidth * CHUNK_SIZE;
  const ch = tileHeight * CHUNK_SIZE;
  const x0 = Math.max(0, Math.floor(view.x / cw) - margin);
  const y0 = Math.max(0, Math.floor(view.y / ch) - margin);
  const x1 = Math.min(count.x - 1, Math.floor((view.x + view.width - 1) / cw) + margin);
  const y1 = Math.min(count.y - 1, Math.floor((view.y + view.height - 1) / ch) + margin);
  return x0 > x1 || y0 > y1 ? null : { x0, y0, x1, y1 };
}

/** Whether chunk (cx, cy) is in a range (null contains nothing). */
export function inRange(range: ChunkRange | null, cx: number, cy: number): boolean {
  return !!range && cx >= range.x0 && cx <= range.x1 && cy >= range.y0 && cy <= range.y1;
}

/** The key a chunk is kept under. */
export const chunkKey = (cx: number, cy: number) => `${cx},${cy}`;

/** The tile rectangle a chunk covers, clipped to the map. */
export function chunkTiles(
  cx: number,
  cy: number,
  mapWidth: number,
  mapHeight: number,
): { x0: number; y0: number; x1: number; y1: number } {
  return {
    x0: cx * CHUNK_SIZE,
    y0: cy * CHUNK_SIZE,
    x1: Math.min(mapWidth, (cx + 1) * CHUNK_SIZE) - 1,
    y1: Math.min(mapHeight, (cy + 1) * CHUNK_SIZE) - 1,
  };
}
