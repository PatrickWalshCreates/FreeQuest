// Choose a map and a cell on it (a transfer's destination) by clicking a
// picture of the map. Drawn on a plain 2D canvas from the tileset image:
// a still overview needs no PixiJS. Events show as markers.
import { CollisionMap } from '@freequest/core';
import type { ProjectDocument } from '@freequest/editor-core';
import { type Direction, EMPTY_TILE, type GameMap, type Tileset } from '@freequest/schema';
import { useEffect, useRef, useState } from 'react';
import { Dialog, Field } from '../Dialog.js';
import { useImage } from '../tileset/image-size.js';

export interface MapPoint {
  readonly map: string;
  readonly x: number;
  readonly y: number;
  readonly direction?: Direction;
}

interface Props {
  readonly doc: ProjectDocument;
  readonly initial: MapPoint;
  readonly title?: string;
  readonly onOk: (point: MapPoint) => void;
  readonly onClose: () => void;
}

const DIRECTIONS: readonly { value: Direction | ''; label: string }[] = [
  { value: '', label: 'Keep facing' },
  { value: 'down', label: '↓ Down' },
  { value: 'left', label: '← Left' },
  { value: 'right', label: '→ Right' },
  { value: 'up', label: '↑ Up' },
];

/** The largest drawing that fits the dialog: whole steps when zooming in, any size when shrinking. */
function fitScale(map: GameMap, tileset: Tileset): number {
  const width = map.width * tileset.tileWidth;
  const height = map.height * tileset.tileHeight;
  const fit = Math.min(720 / width, 440 / height);
  return fit >= 1 ? Math.min(3, Math.floor(fit)) : fit;
}

export function MapPointPicker({
  doc,
  initial,
  title = 'Choose a destination',
  onOk,
  onClose,
}: Props) {
  const maps = [...doc.project.maps.values()].filter((m) => m.data);
  const [point, setPoint] = useState<MapPoint>(initial);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const map = doc.project.maps.get(point.map)?.data ?? null;
  const tileset = map ? (doc.project.tilesets.get(map.tileset)?.data ?? null) : null;
  const image = useImage(doc, tileset?.image ?? null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scale = map && tileset ? fitScale(map, tileset) : 1;
  const inside = map ? point.x < map.width && point.y < map.height : false;

  const collision = (() => {
    if (!map || !tileset) return null;
    try {
      return CollisionMap.fromMap(map, tileset);
    } catch {
      return null;
    }
  })();
  const blocked = inside && collision ? !collision.isPassable(point.x, point.y) : false;
  const eventHere = map?.events.find((e) => e.x === point.x && e.y === point.y);

  // Draw the map: every layer's tiles, then event markers, then the chosen cell.
  const info = image.status === 'ready' ? image.value : null;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !map || !tileset || !info) return;
    const context = element.getContext('2d');
    if (!context) return;
    const picture = new Image();
    picture.src = info.url;
    let cancelled = false;
    void picture.decode().then(() => {
      if (cancelled) return;
      const { tileWidth: tw, tileHeight: th, columns } = tileset;
      context.imageSmoothingEnabled = false;
      context.clearRect(0, 0, element.width, element.height);
      context.save();
      context.scale(scale, scale);
      for (const layer of map.layers) {
        layer.data.forEach((row, y) =>
          row.forEach((tile, x) => {
            if (tile === EMPTY_TILE) return;
            const sx = (tile % columns) * tw;
            const sy = Math.floor(tile / columns) * th;
            context.drawImage(picture, sx, sy, tw, th, x * tw, y * th, tw, th);
          }),
        );
      }
      context.fillStyle = 'rgba(255, 215, 106, 0.55)';
      for (const event of map.events) {
        context.fillRect(event.x * tw + tw * 0.3, event.y * th + th * 0.3, tw * 0.4, th * 0.4);
      }
      context.restore();
    });
    return () => {
      cancelled = true;
    };
  }, [map, tileset, info, scale]);

  if (maps.length === 0) {
    return (
      <Dialog title={title} onClose={onClose}>
        <p>This project has no maps.</p>
      </Dialog>
    );
  }

  const cellAt = (event: React.MouseEvent<HTMLElement>) => {
    if (!map || !tileset) return null;
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.floor((event.clientX - rect.left) / (tileset.tileWidth * scale));
    const y = Math.floor((event.clientY - rect.top) / (tileset.tileHeight * scale));
    return x >= 0 && y >= 0 && x < map.width && y < map.height ? { x, y } : null;
  };
  const cellStyle = (cell: { x: number; y: number }) =>
    tileset
      ? {
          left: cell.x * tileset.tileWidth * scale,
          top: cell.y * tileset.tileHeight * scale,
          width: tileset.tileWidth * scale,
          height: tileset.tileHeight * scale,
        }
      : {};

  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="form map-picker"
        onSubmit={(event) => {
          event.preventDefault();
          // React passes events up through portals: keep this submit from also
          // submitting the dialog that opened the picker.
          event.stopPropagation();
          if (inside) onOk(point);
        }}
      >
        <div className="row">
          <Field label="Map">
            <select
              value={point.map}
              onChange={(e) => {
                const next = doc.project.maps.get(e.target.value)?.data;
                setPoint({
                  ...point,
                  map: e.target.value,
                  x: Math.min(point.x, (next?.width ?? 1) - 1),
                  y: Math.min(point.y, (next?.height ?? 1) - 1),
                });
              }}
            >
              {maps.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.data?.name ?? m.id}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Facing">
            <select
              value={point.direction ?? ''}
              onChange={(e) => {
                const value = e.target.value as Direction | '';
                const { direction: _, ...rest } = point;
                setPoint(value ? { ...rest, direction: value } : rest);
              }}
            >
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div className="map-picker-view">
          {image.status === 'loading' && <p className="muted">Loading the map…</p>}
          {image.status === 'error' && <p className="error">{image.message}</p>}
          {map && tileset && info && (
            <div
              className="map-picker-canvas"
              style={{
                width: map.width * tileset.tileWidth * scale,
                height: map.height * tileset.tileHeight * scale,
              }}
              onMouseMove={(e) => setHover(cellAt(e))}
              onMouseLeave={() => setHover(null)}
              onClick={(e) => {
                const cell = cellAt(e);
                if (cell) setPoint({ ...point, ...cell });
              }}
              onDoubleClick={(e) => {
                const cell = cellAt(e);
                if (cell) onOk({ ...point, ...cell });
              }}
            >
              <canvas
                ref={canvas}
                width={Math.ceil(map.width * tileset.tileWidth * scale)}
                height={Math.ceil(map.height * tileset.tileHeight * scale)}
              />
              {hover && <div className="map-picker-hover" style={cellStyle(hover)} />}
              {inside && <div className="map-picker-chosen" style={cellStyle(point)} />}
            </div>
          )}
        </div>
        <p className={blocked ? 'error-text small' : 'muted small'}>
          {inside ? `Cell ${point.x}, ${point.y}` : 'Click a cell'}
          {hover ? ` · pointer at ${hover.x}, ${hover.y}` : ''}
          {blocked ? ' · this tile isn’t walkable: the player would be stuck' : ''}
          {eventHere ? ` · on event “${eventHere.name}”` : ''}
        </p>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!inside}>
            Use this cell
          </button>
        </div>
      </form>
    </Dialog>
  );
}
