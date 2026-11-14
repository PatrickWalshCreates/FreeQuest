// Stamps: blocks of tiles to paint with. The brush is always a stamp: one
// tile is a 1 × 1 stamp, a block dragged out of the palette is a stamp for
// the active layer, and an area copied from a map is a stamp with a grid per
// layer. Pure functions over map data; `TileStroke` paints with them.
import { EMPTY_TILE, type GameMap, type Tileset } from '@freequest/schema';
import { type TileCell, inBounds, setTiles, tileAt } from './map-edits.js';
import type { Cell } from './tools.js';

/** A rows × columns grid of tile indices (EMPTY_TILE clears a cell). */
export type TileGrid = readonly (readonly number[])[];

export interface Stamp {
  readonly width: number;
  readonly height: number;
  /**
   * One grid: painted on the active layer. Several: one per map layer, from
   * layer 0 up (an area copied with every layer).
   */
  readonly layers: readonly TileGrid[];
}

/** Tiles to set on one layer. */
export interface LayerEdit {
  readonly layer: number;
  readonly cells: readonly TileCell[];
}

/** A single tile as a stamp. */
export function tileStamp(tile: number): Stamp {
  return { width: 1, height: 1, layers: [[[tile]]] };
}

/** The single tile a 1 × 1, one-layer stamp paints, or null for anything bigger. */
export function singleTileOf(stamp: Stamp): number | null {
  return stamp.width === 1 && stamp.height === 1 && stamp.layers.length === 1
    ? (stamp.layers[0]?.[0]?.[0] ?? null)
    : null;
}

const span = (a: number, b: number) => [Math.min(a, b), Math.max(a, b)] as const;

/**
 * The block of the tileset between two palette cells (columns and rows of
 * its image, corners in any order), as a stamp. Cells past the tileset's
 * last tile are left out of the block (they paint nothing).
 */
export function paletteStamp(tileset: Tileset, a: Cell, b: Cell): Stamp {
  const [x0, x1] = span(a.x, b.x);
  const [y0, y1] = span(a.y, b.y);
  const rows: number[][] = [];
  for (let y = y0; y <= y1; y++) {
    const row: number[] = [];
    for (let x = x0; x <= x1; x++) {
      const index = y * tileset.columns + x;
      row.push(x < tileset.columns && index < tileset.tiles.length ? index : EMPTY_TILE);
    }
    rows.push(row);
  }
  return { width: x1 - x0 + 1, height: y1 - y0 + 1, layers: [rows] };
}

/** The map cells between two corners (any order), clipped to the map; null if none are on it. */
export function areaOnMap(
  map: GameMap,
  a: Cell,
  b: Cell,
): {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
} | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const x1 = Math.min(map.width - 1, Math.max(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const y1 = Math.min(map.height - 1, Math.max(a.y, b.y));
  if (x0 > x1 || y0 > y1) return null;
  return { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/**
 * Copy an area of a map as a stamp: every layer (one grid each), or just
 * `layer`. Null when the area is entirely off the map.
 */
export function copyArea(map: GameMap, a: Cell, b: Cell, layer?: number): Stamp | null {
  const area = areaOnMap(map, a, b);
  if (!area) return null;
  const layers = layer === undefined ? map.layers.map((_, i) => i) : [layer];
  return {
    width: area.width,
    height: area.height,
    layers: layers.map((l) => {
      const rows: number[][] = [];
      for (let y = area.y; y < area.y + area.height; y++) {
        const row: number[] = [];
        for (let x = area.x; x < area.x + area.width; x++) row.push(tileAt(map, l, x, y));
        rows.push(row);
      }
      return rows;
    }),
  };
}

/** Clear an area (every layer, or just `layer`), for cutting. */
export function clearArea(map: GameMap, a: Cell, b: Cell, layer?: number): GameMap {
  const area = areaOnMap(map, a, b);
  if (!area) return map;
  const cells: TileCell[] = [];
  for (let y = area.y; y < area.y + area.height; y++) {
    for (let x = area.x; x < area.x + area.width; x++) cells.push({ x, y, tile: EMPTY_TILE });
  }
  const layers = layer === undefined ? map.layers.map((_, i) => i) : [layer];
  return applyEdits(
    map,
    layers.map((l) => ({ layer: l, cells })),
  );
}

/** Which map layer each of a stamp's grids paints. Grids for layers the map lacks are dropped. */
function targetLayers(stamp: Stamp, map: GameMap, activeLayer: number): number[] {
  if (stamp.layers.length === 1) return [activeLayer];
  return stamp.layers.map((_, i) => i).filter((i) => i < map.layers.length);
}

const wrap = (n: number, size: number) => ((n % size) + size) % size;

/**
 * The tiles a stamp paints when placed with its top-left corner at `at`,
 * clipped to the map. Palette cells past the tileset (EMPTY_TILE in a
 * one-layer stamp) are skipped; in a copied area they clear the cell, so a
 * paste matches what was copied.
 */
export function placeStamp(stamp: Stamp, map: GameMap, at: Cell, activeLayer: number): LayerEdit[] {
  const skipEmpty = stamp.layers.length === 1;
  return targetLayers(stamp, map, activeLayer).map((layer, g) => {
    const grid = stamp.layers[stamp.layers.length === 1 ? 0 : g] ?? [];
    const cells: TileCell[] = [];
    for (let dy = 0; dy < stamp.height; dy++) {
      for (let dx = 0; dx < stamp.width; dx++) {
        const tile = grid[dy]?.[dx] ?? EMPTY_TILE;
        const x = at.x + dx;
        const y = at.y + dy;
        if ((skipEmpty && tile === EMPTY_TILE) || !inBounds(map, x, y)) continue;
        cells.push({ x, y, tile });
      }
    }
    return { layer, cells };
  });
}

/**
 * Paint `cells` with the stamp as a repeating pattern anchored at `origin`,
 * so the area reads as the stamp tiled from there (rectangles and fills).
 */
export function patternStamp(
  stamp: Stamp,
  map: GameMap,
  origin: Cell,
  cells: readonly Cell[],
  activeLayer: number,
): LayerEdit[] {
  const skipEmpty = stamp.layers.length === 1;
  return targetLayers(stamp, map, activeLayer).map((layer, g) => {
    const grid = stamp.layers[stamp.layers.length === 1 ? 0 : g] ?? [];
    const out: TileCell[] = [];
    for (const { x, y } of cells) {
      if (!inBounds(map, x, y)) continue;
      const tile =
        grid[wrap(y - origin.y, stamp.height)]?.[wrap(x - origin.x, stamp.width)] ?? EMPTY_TILE;
      if (skipEmpty && tile === EMPTY_TILE) continue;
      out.push({ x, y, tile });
    }
    return { layer, cells: out };
  });
}

/** Where a dragged stamp's copy lands for `cell`: on a grid of stamp-sized blocks from `start`. */
export function blockOrigin(stamp: Stamp, start: Cell, cell: Cell): Cell {
  return {
    x: start.x + Math.floor((cell.x - start.x) / stamp.width) * stamp.width,
    y: start.y + Math.floor((cell.y - start.y) / stamp.height) * stamp.height,
  };
}

/** Apply layer edits to a map (unchanged layers keep their objects). */
export function applyEdits(map: GameMap, edits: readonly LayerEdit[]): GameMap {
  return edits.reduce((m, edit) => setTiles(m, edit.layer, edit.cells), map);
}
