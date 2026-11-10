// Tile painting tools: the cells each tool touches, and a stroke that turns
// one press-drag-release into a single undo step.
import { EMPTY_TILE, type GameMap } from '@freequest/schema';
import type { ProjectDocument } from './document.js';
import { type TileCell, inBounds, setTiles, tileAt } from './map-edits.js';

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
  /** The palette's tile (ignored by the eraser and eyedropper). */
  readonly tile: number;
}

let strokeCount = 0;

/**
 * One press-drag-release of a tool. Pencil and eraser paint as the pointer
 * moves (filling gaps between pointer events); rectangle previews until
 * release; fill and eyedropper act once on press. Everything one stroke
 * changes is one undo step.
 */
export class TileStroke {
  private readonly key = `stroke:${++strokeCount}`;
  private readonly start: Cell;
  private last: Cell;
  private finished = false;
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
      this.paint(floodCells(this.map, layer, cell));
    } else if (tool !== 'rectangle') {
      this.paint([cell]);
    }
  }

  private get map(): GameMap {
    const data = this.options.doc.file(this.options.path)?.data;
    if (!data) throw new Error(`"${this.options.path}" can't be painted`);
    return data as GameMap;
  }

  private get tile(): number {
    return this.options.tool === 'eraser' ? EMPTY_TILE : this.options.tile;
  }

  private paint(cells: readonly Cell[]): void {
    const { doc, path, layer, tool } = this.options;
    const tile = this.tile;
    const edits: TileCell[] = cells.map(({ x, y }) => ({ x, y, tile }));
    const changed = doc.update(path, 'map', TOOL_LABELS[tool], (m) => setTiles(m, layer, edits), {
      coalesce: this.key,
    });
    this.changed ||= changed;
  }

  /** Cells to show as a preview of what release will paint (rectangle only). */
  get preview(): readonly TileCell[] {
    if (this.options.tool !== 'rectangle' || this.finished) return [];
    const tile = this.tile;
    return rectCells(this.start, this.last)
      .filter(({ x, y }) => inBounds(this.map, x, y))
      .map(({ x, y }) => ({ x, y, tile }));
  }

  /** The pointer moved to `cell` (may be outside the map; those cells are skipped). */
  moveTo(cell: Cell): void {
    if (this.finished || (cell.x === this.last.x && cell.y === this.last.y)) return;
    const { tool } = this.options;
    if (tool === 'pencil' || tool === 'eraser') this.paint(lineCells(this.last, cell).slice(1));
    this.last = cell;
  }

  /** Release: commit a rectangle and close the undo step. */
  finish(): void {
    if (this.finished) return;
    if (this.options.tool === 'rectangle') this.paint(rectCells(this.start, this.last));
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
