// Tile painting tools: the cells each tool touches, and a stroke that turns
// one press-drag-release into a single undo step.
import { EMPTY_TILE, type GameMap } from '@freequest/schema';
import type { ProjectDocument } from './document.js';
import { type TileCell, inBounds, tileAt } from './map-edits.js';
import {
  type LayerEdit,
  type Stamp,
  applyEdits,
  blockOrigin,
  placeStamp,
  patternStamp,
  tileStamp,
} from './stamps.js';

export type TileTool = 'pencil' | 'rectangle' | 'fill' | 'eraser' | 'eyedropper';

export interface Cell {
  readonly x: number;
  readonly y: number;
}

export const TOOL_LABELS: Record<TileTool, string> = {
  pencil: 'Paint tiles',
  rectangle: 'Draw rectangle',
  fill: 'Fill area',
  eraser: 'Erase tiles',
  eyedropper: 'Pick tile',
};

/** Every cell on the straight line from `a` to `b` (inclusive), with no gaps (Bresenham). */
export function lineCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  const dx = Math.abs(b.x - a.x);
  const dy = -Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let error = dx + dy;
  let { x, y } = a;
  for (;;) {
    cells.push({ x, y });
    if (x === b.x && y === b.y) return cells;
    const e2 = 2 * error;
    if (e2 >= dy) {
      error += dy;
      x += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/** Every cell of the filled rectangle with corners `a` and `b`, row by row. */
export function rectCells(a: Cell, b: Cell): Cell[] {
  const cells: Cell[] = [];
  for (let y = Math.min(a.y, b.y); y <= Math.max(a.y, b.y); y++) {
    for (let x = Math.min(a.x, b.x); x <= Math.max(a.x, b.x); x++) cells.push({ x, y });
  }
  return cells;
}

/**
 * The connected area (4-neighbour) around `start` that has the same tile as
 * `start` on `layer`. Empty when `start` is outside the map.
 */
export function floodCells(map: GameMap, layer: number, start: Cell): Cell[] {
  if (!inBounds(map, start.x, start.y)) return [];
  const target = tileAt(map, layer, start.x, start.y);
  const seen = new Uint8Array(map.width * map.height);
  const cells: Cell[] = [];
  const stack: Cell[] = [start];
  while (stack.length > 0) {
    const cell = stack.pop();
    if (!cell || !inBounds(map, cell.x, cell.y)) continue;
    const i = cell.y * map.width + cell.x;
    if (seen[i] || tileAt(map, layer, cell.x, cell.y) !== target) continue;
    seen[i] = 1;
    cells.push(cell);
    stack.push(
      { x: cell.x + 1, y: cell.y },
      { x: cell.x - 1, y: cell.y },
      { x: cell.x, y: cell.y + 1 },
      { x: cell.x, y: cell.y - 1 },
    );
  }
  return cells;
}

export interface StrokeOptions {
  readonly doc: ProjectDocument;
  /** Path of the map file being painted. */
  readonly path: string;
  readonly layer: number;
  readonly tool: TileTool;
  /** What to paint: one tile, a block from the palette or a copied area (ignored by the eraser and eyedropper). */
  readonly stamp: Stamp;
}

let strokeCount = 0;

/**
 * One press-drag-release of a tool. The pencil places the whole stamp at the
 * press and, while dragging, more copies on a grid of stamp-sized blocks (so a
 * fence or wall tiles seamlessly); the eraser clears cells as the pointer
 * moves (filling gaps between pointer events); rectangle and fill paint the
 * stamp as a pattern anchored at the press (the rectangle previews until
 * release); the eyedropper only reads. Everything one stroke changes is one
 * undo step.
 */
export class TileStroke {
  private readonly key = `stroke:${++strokeCount}`;
  private readonly start: Cell;
  private last: Cell;
  private finished = false;
  /** Blocks the pencil has placed this stroke ("x,y" of their top-left cell). */
  private readonly placed = new Set<string>();
  /** Whether this stroke has changed the map (and so has an undo step). */
  private changed = false;
  /** For the eyedropper: the tile under the press (EMPTY_TILE for an empty cell). */
  readonly picked: number | null = null;

  constructor(
    private readonly options: StrokeOptions,
    cell: Cell,
  ) {
    this.start = cell;
    this.last = cell;
    const { tool, layer } = options;
    if (tool === 'eyedropper') {
      this.picked = tileAt(this.map, layer, cell.x, cell.y);
    } else if (tool === 'fill') {
      this.apply(
        patternStamp(this.stamp, this.map, cell, floodCells(this.map, layer, cell), layer),
      );
    } else if (tool === 'pencil') {
      this.placeAt(cell);
    } else if (tool === 'eraser') {
      this.erase([cell]);
    }
  }

  /** The eraser always clears single cells of the active layer. */
  private get stamp(): Stamp {
    return this.options.tool === 'eraser' ? tileStamp(EMPTY_TILE) : this.options.stamp;
  }

  /** Place a copy of the stamp on the block containing `cell` (once per block per stroke). */
  private placeAt(cell: Cell): void {
    const origin = blockOrigin(this.stamp, this.start, cell);
    const key = `${origin.x},${origin.y}`;
    if (this.placed.has(key)) return;
    this.placed.add(key);
    this.apply(placeStamp(this.stamp, this.map, origin, this.options.layer));
  }

  private erase(cells: readonly Cell[]): void {
    const tile = EMPTY_TILE;
    this.apply([{ layer: this.options.layer, cells: cells.map(({ x, y }) => ({ x, y, tile })) }]);
  }

  private get map(): GameMap {
    const data = this.options.doc.file(this.options.path)?.data;
    if (!data) throw new Error(`"${this.options.path}" can't be painted`);
    return data as GameMap;
  }

  private apply(edits: readonly LayerEdit[]): void {
    const { doc, path, tool } = this.options;
    const changed = doc.update(path, 'map', TOOL_LABELS[tool], (m) => applyEdits(m, edits), {
      coalesce: this.key,
    });
    this.changed ||= changed;
  }

  /** Cells to show as a preview of what release will paint (rectangle only), every layer's together. */
  get preview(): readonly TileCell[] {
    if (this.options.tool !== 'rectangle' || this.finished) return [];
    return patternStamp(
      this.stamp,
      this.map,
      this.start,
      rectCells(this.start, this.last),
      this.options.layer,
    ).flatMap((edit) => edit.cells);
  }

  /** The pointer moved to `cell` (may be outside the map; those cells are skipped). */
  moveTo(cell: Cell): void {
    if (this.finished || (cell.x === this.last.x && cell.y === this.last.y)) return;
    const { tool } = this.options;
    const line = lineCells(this.last, cell).slice(1);
    if (tool === 'eraser') this.erase(line);
    else if (tool === 'pencil') for (const c of line) this.placeAt(c);
    this.last = cell;
  }

  /** Release: commit a rectangle and close the undo step. */
  finish(): void {
    if (this.finished) return;
    if (this.options.tool === 'rectangle') {
      const cells = rectCells(this.start, this.last);
      this.apply(patternStamp(this.stamp, this.map, this.start, cells, this.options.layer));
    }
    this.finished = true;
    this.options.doc.endCoalescing();
  }

  /** Abandon the stroke (e.g. Escape): a rectangle paints nothing; other tools undo their step. */
  cancel(): void {
    if (this.finished) return;
    this.finished = true;
    this.options.doc.endCoalescing();
    if (this.changed) this.options.doc.undo();
  }
}
