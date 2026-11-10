import type { Tileset } from '@freequest/schema';
import { useState } from 'react';

interface Props {
  readonly tileset: Tileset;
  /** URL of the tileset image. */
  readonly imageUrl: string;
  readonly selected: number;
  readonly onSelect: (tile: number) => void;
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

/** The tileset image as a grid of tiles to pick from. */
export function TilePalette({ tileset, imageUrl, selected, onSelect, width }: Props) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { tileWidth: tw, tileHeight: th, columns } = tileset;
  const rows = Math.ceil(tileset.tiles.length / columns);
  // Whole-number scaling keeps pixel art crisp.
  const scale = Math.max(1, Math.floor(width / (columns * tw)));
  const cell = (index: number) => ({
    left: (index % columns) * tw * scale,
    top: Math.floor(index / columns) * th * scale,
    width: tw * scale,
    height: th * scale,
  });
  const indexAt = (event: React.MouseEvent<HTMLDivElement>): number | null => {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (tw * scale));
    const y = Math.floor((event.clientY - rect.top) / (th * scale));
    const index = y * columns + x;
    return x >= 0 && x < columns && index >= 0 && index < tileset.tiles.length ? index : null;
  };

  return (
    <div className="palette">
      <div
        className="palette-image"
        role="listbox"
        aria-label={`${tileset.name} tiles`}
        style={{ width: columns * tw * scale, height: rows * th * scale }}
        onMouseMove={(event) => setHovered(indexAt(event))}
        onMouseLeave={() => setHovered(null)}
        onClick={(event) => {
          const index = indexAt(event);
          if (index !== null) onSelect(index);
        }}
      >
        <img
          src={imageUrl}
          alt=""
          draggable={false}
          style={{ width: columns * tw * scale, imageRendering: 'pixelated' }}
        />
        {hovered !== null && hovered !== selected && (
          <div className="palette-hover" style={cell(hovered)} />
        )}
        <div
          className="palette-selected"
          style={cell(selected)}
          role="option"
          aria-selected
          aria-label={describeTile(tileset, selected)}
        />
      </div>
      <p className="palette-info">
        <strong>{hovered ?? selected}</strong> {describeTile(tileset, hovered ?? selected)}
      </p>
    </div>
  );
}
