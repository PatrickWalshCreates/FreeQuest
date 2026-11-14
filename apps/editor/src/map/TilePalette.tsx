import { type Cell, type Stamp, paletteStamp } from '@freequest/editor-core';
import type { Tileset } from '@freequest/schema';
import { useRef, useState } from 'react';

/** A block of the palette (columns and rows of the tileset image), corners in any order. */
export interface PaletteBlock {
  readonly a: Cell;
  readonly b: Cell;
}

interface Props {
  readonly tileset: Tileset;
  /** URL of the tileset image. */
  readonly imageUrl: string;
  /** The block the brush came from, or null when the brush is a copied map area. */
  readonly selected: PaletteBlock | null;
  readonly onSelect: (stamp: Stamp, block: PaletteBlock) => void;
  /** Width available for the image, in CSS pixels. */
  readonly width: number;
}

/** What the palette and status bar say about a tile. */
export function describeTile(tileset: Tileset, index: number): string {
  const tile = tileset.tiles[index];
  if (!tile) return 'empty';
  const flags = [tile.passable ? 'walkable' : 'blocks', ...(tile.above ? ['drawn above'] : [])];
  return `${tile.name ?? `tile ${index}`} (${flags.join(', ')})`;
}

/** The tileset image as a grid of tiles to pick from: click a tile, or drag out a block. */
export function TilePalette({ tileset, imageUrl, selected, onSelect, width }: Props) {
  const [hovered, setHovered] = useState<Cell | null>(null);
  /** The block being dragged out (press to here), until release. A ref too, so a release
   *  that comes before React has drawn the press still finds it. */
  const [dragging, setDraggingState] = useState<PaletteBlock | null>(null);
  const drag = useRef<PaletteBlock | null>(null);
  const setDragging = (block: PaletteBlock | null) => {
    drag.current = block;
    setDraggingState(block);
  };
  const { tileWidth: tw, tileHeight: th, columns } = tileset;
  const rows = Math.ceil(tileset.tiles.length / columns);
  // Whole-number scaling keeps pixel art crisp.
  const scale = Math.max(1, Math.floor(width / (columns * tw)));
  const box = (block: PaletteBlock) => ({
    left: Math.min(block.a.x, block.b.x) * tw * scale,
    top: Math.min(block.a.y, block.b.y) * th * scale,
    width: (Math.abs(block.a.x - block.b.x) + 1) * tw * scale,
    height: (Math.abs(block.a.y - block.b.y) + 1) * th * scale,
  });
  const cellAt = (event: React.PointerEvent<HTMLDivElement>): Cell | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (tw * scale));
    const y = Math.floor((event.clientY - rect.top) / (th * scale));
    return x >= 0 && x < columns && y >= 0 && y < rows ? { x, y } : null;
  };
  const indexOf = (c: Cell) => c.y * columns + c.x;
  const shown = dragging ?? selected;
  const single =
    shown && shown.a.x === shown.b.x && shown.a.y === shown.b.y ? indexOf(shown.a) : null;
  const info = hovered
    ? `${indexOf(hovered)} ${describeTile(tileset, indexOf(hovered))}`
    : single !== null
      ? `${single} ${describeTile(tileset, single)}`
      : shown
        ? `${Math.abs(shown.a.x - shown.b.x) + 1} × ${Math.abs(shown.a.y - shown.b.y) + 1} tiles`
        : 'Copied area';

  return (
    <div className="palette">
      <div
        className="palette-image"
        role="listbox"
        aria-label={`${tileset.name} tiles`}
        style={{ width: columns * tw * scale, height: rows * th * scale }}
        onPointerDown={(event) => {
          const c = cellAt(event);
          if (!c || event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging({ a: c, b: c });
        }}
        onPointerMove={(event) => {
          const c = cellAt(event);
          setHovered(c);
          if (c && drag.current) setDragging({ a: drag.current.a, b: c });
        }}
        onPointerUp={() => {
          const block = drag.current;
          if (!block) return;
          onSelect(paletteStamp(tileset, block.a, block.b), block);
          setDragging(null);
        }}
        onPointerLeave={() => setHovered(null)}
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{ width: columns * tw * scale, imageRendering: 'pixelated' }}
        />
        {hovered && !dragging && (
          <div className="palette-hover" style={box({ a: hovered, b: hovered })} />
        )}
        {shown && (
          <div
            className="palette-selected"
            style={box(shown)}
            role="option"
            aria-selected
            aria-label={single !== null ? describeTile(tileset, single) : info}
          />
        )}
      </div>
      <p className="palette-info">{info}</p>
      <p className="palette-hint muted">Drag across tiles to paint a block of them.</p>
    </div>
  );
}
