// Pure edits on map data. Each returns a new map sharing every untouched
// part, or the same map when nothing would change (so no undo step is made).
import { EMPTY_TILE, type GameMap } from '@freequest/schema';

export interface TileCell {
  readonly x: number;
  readonly y: number;
  /** Tile index, or EMPTY_TILE (-1) to clear the cell. */
  readonly tile: number;
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x < map.width &&
    y < map.height
  );
}

/** The tile at a cell of a layer; EMPTY_TILE outside the map. */
export function tileAt(map: GameMap, layer: number, x: number, y: number): number {
  return map.layers[layer]?.data[y]?.[x] ?? EMPTY_TILE;
}

/**
 * Set cells of one layer. Cells outside the map are ignored; only the rows
 * that actually change are copied.
 */
export function setTiles(map: GameMap, layer: number, cells: Iterable<TileCell>): GameMap {
  const source = map.layers[layer];
  if (!source) throw new RangeError(`map "${map.id}" has no layer ${layer}`);
  const rows = new Map<number, number[]>(); // copied rows by y
  for (const { x, y, tile } of cells) {
    if (!inBounds(map, x, y)) continue;
    const row = rows.get(y) ?? source.data[y];
    if (!row || row[x] === tile) continue;
    let copy = rows.get(y);
    if (!copy) {
      copy = [...row];
      rows.set(y, copy);
    }
    copy[x] = tile;
  }
  // A cell set and then set back within one call leaves a row equal to the original.
  for (const [y, row] of rows) {
    if (row.every((t, x) => t === source.data[y]?.[x])) rows.delete(y);
  }
  if (rows.size === 0) return map;
  const data = source.data.map((row, y) => rows.get(y) ?? row);
  return { ...map, layers: map.layers.map((l, i) => (i === layer ? { ...l, data } : l)) };
}
