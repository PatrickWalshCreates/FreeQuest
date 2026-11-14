// The tileset editor: the image cut into its grid, with each tile's flags
// drawn on top. Click or drag to set walkability or "drawn above"; select a
// tile to name it. Edits are pure functions in editor-core/tileset-edits.ts.
import {
  type ProjectDocument,
  type ProjectFile,
  fitTileset,
  fitsImage,
  setAbove,
  setPassable,
  setTileName,
  tileGrid,
  tilesetUsages,
} from '@freequest/editor-core';
import type { Tileset } from '@freequest/schema';
import { useEffect, useRef, useState } from 'react';
import { useProjectLists } from '../forms/use-project-lists.js';
import { confirmAction } from '../platform.js';
import { useElementSize } from '../use-element-size.js';
import { type ImageInfo, useImage } from './image-size.js';
import { RenameIdButton } from '../RenameIdButton.js';

type Mode = 'passage' | 'above' | 'select';

const MODES: readonly { id: Mode; label: string; key: string; hint: string }[] = [
  {
    id: 'passage',
    label: 'Walkable',
    key: 'w',
    hint: 'Click or drag to switch tiles between walkable and blocking',
  },
  {
    id: 'above',
    label: 'Above',
    key: 'a',
    hint: 'Click or drag to mark tiles drawn above characters (treetops, roofs)',
  },
  { id: 'select', label: 'Select', key: 's', hint: 'Click a tile to name it and see its flags' },
];

const ZOOMS = [1, 2, 3, 4, 6, 8];

interface Props {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<'tileset'> & { readonly data: Tileset };
}

let strokes = 0;

export function TilesetEditor({ doc, file }: Props) {
  const tileset = file.data;
  const image = useImage(doc, tileset.image);
  const [mode, setMode] = useState<Mode>('passage');
  const [selected, setSelected] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  const paint = useRef<{ value: boolean; key: string } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);
  // Room inside the canvas's padding (16 px each side).
  const space = useElementSize(canvas, 16);

  const change = (label: string, fn: (t: Tileset) => Tileset, coalesce?: string) =>
    doc.update(file.path, 'tileset', label, fn, coalesce ? { coalesce } : {});

  // A drag that sets flags is one undo step, ending when the button comes up.
  useEffect(() => {
    const end = () => {
      if (!paint.current) return;
      paint.current = null;
      doc.endCoalescing();
    };
    window.addEventListener('pointerup', end);
    return () => window.removeEventListener('pointerup', end);
  }, [doc]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return;
      const next = MODES.find((m) => m.key === event.key.toLowerCase());
      if (next) setMode(next.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const apply = (index: number, value: boolean, key: string) => {
    if (mode === 'passage') change('Set walkable', (t) => setPassable(t, [index], value), key);
    if (mode === 'above') change('Set drawn above', (t) => setAbove(t, [index], value), key);
  };
  const press = (index: number) => {
    setSelected(index);
    const tile = tileset.tiles[index];
    if (mode === 'select' || !tile) return;
    const value = mode === 'passage' ? !tile.passable : !(tile.above ?? false);
    paint.current = { value, key: `tileset-paint:${++strokes}` };
    apply(index, value, paint.current.key);
  };
  const enter = (index: number, buttons: number) => {
    const stroke = paint.current;
    if (!stroke || (buttons & 1) === 0) return;
    apply(index, stroke.value, stroke.key);
  };

  const info = image.status === 'ready' ? image.value : null;
  const { tileWidth: tw, tileHeight: th, columns } = tileset;
  const rows = Math.ceil(tileset.tiles.length / columns);
  // Until a zoom is chosen, the largest one that shows the whole image.
  const fitZoom =
    [...ZOOMS]
      .reverse()
      .find((z) => columns * tw * z <= space.width && rows * th * z <= space.height) ?? 1;
  const scale = zoom ?? fitZoom;
  const tile = tileset.tiles[selected];

  return (
    <div className="tileset-editor">
      <div className="tileset-main">
        <div className="map-toolbar" role="toolbar" aria-label="Tileset tools">
          <div className="segmented" role="radiogroup" aria-label="Mode">
            {MODES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={mode === m.id}
                className={mode === m.id ? 'on' : undefined}
                title={`${m.hint} (${m.key.toUpperCase()})`}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <span className="divider" />
          <label className="inline">
            <span className="muted">Zoom</span>
            <select
              value={scale}
              onChange={(e) => setZoom(Number(e.target.value))}
              aria-label="Zoom"
            >
              {ZOOMS.map((z) => (
                <option key={z} value={z}>
                  {z}×
                </option>
              ))}
            </select>
          </label>
          <span className="spacer" />
          <span className="muted small">
            {mode === 'passage'
              ? '○ walkable · × blocks · ★ drawn above (never blocks)'
              : mode === 'above'
                ? '★ drawn above characters, ignored for walking'
                : 'Click a tile to edit it'}
          </span>
        </div>
        <div className="tileset-canvas" ref={canvas}>
          {image.status === 'loading' && <p className="muted">Loading image…</p>}
          {image.status === 'error' && <p className="error">{image.message}</p>}
          {info && (
            <div
              className={`tileset-grid mode-${mode}`}
              style={{
                width: columns * tw * scale,
                height: rows * th * scale,
                gridTemplateColumns: `repeat(${columns}, ${tw * scale}px)`,
                gridAutoRows: `${th * scale}px`,
              }}
            >
              <img
                src={info.url}
                alt=""
                draggable={false}
                style={{ width: info.width * scale, height: info.height * scale }}
              />
              {tileset.tiles.map((t, i) => (
                <div
                  key={i}
                  className={[
                    'tileset-cell',
                    i === selected ? 'selected' : '',
                    mode === 'passage' && !t.above ? (t.passable ? 'walk' : 'block') : '',
                    t.above && mode !== 'select' ? 'above' : '',
                  ].join(' ')}
                  title={`${i}: ${t.name ?? 'unnamed'}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    press(i);
                  }}
                  onPointerEnter={(event) => enter(i, event.buttons)}
                >
                  <span aria-hidden>
                    {mode === 'select'
                      ? ''
                      : t.above
                        ? '★'
                        : mode === 'passage'
                          ? t.passable
                            ? '○'
                            : '×'
                          : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <aside className="map-side tileset-side">
        {tile && (
          <section>
            <h2>Tile {selected}</h2>
            <p className="muted small">
              Column {(selected % columns) + 1}, row {Math.floor(selected / columns) + 1}
            </p>
            <label className="field">
              <span>Name</span>
              <input
                value={tile.name ?? ''}
                placeholder="(unnamed)"
                spellCheck={false}
                onChange={(e) => {
                  const name = e.target.value;
                  change(
                    'Name tile',
                    (t) => setTileName(t, selected, name),
                    `tile-name:${file.path}:${selected}`,
                  );
                }}
                onBlur={() => doc.endCoalescing()}
              />
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={tile.passable}
                onChange={(e) =>
                  change('Set walkable', (t) => setPassable(t, [selected], e.target.checked))
                }
              />
              Walkable
            </label>
            <label className="toggle">
              <input
                type="checkbox"
                checked={tile.above ?? false}
                onChange={(e) =>
                  change('Set drawn above', (t) => setAbove(t, [selected], e.target.checked))
                }
              />
              Drawn above characters
            </label>
            <p className="hint">
              A cell is walkable when every tile on it is (tiles drawn above don't count).
            </p>
          </section>
        )}
        {/* Keyed by the grid so the size fields start from it again after a change (or undo). */}
        <GridSettings
          key={`${tileset.tileWidth}x${tileset.tileHeight}`}
          doc={doc}
          file={file}
          image={info}
        />
      </aside>
    </div>
  );
}

/** Image and tile size. Re-cutting a tileset that maps use changes what they show. */
function GridSettings({
  doc,
  file,
  image,
}: {
  readonly doc: ProjectDocument;
  readonly file: Props['file'];
  readonly image: ImageInfo | null;
}) {
  const tileset = file.data;
  const images = useProjectLists(doc).images ?? [];
  const [width, setWidth] = useState(tileset.tileWidth);
  const [height, setHeight] = useState(tileset.tileHeight);
  const users = tilesetUsages(doc.project, tileset.id);
  const valid = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  const fits = image ? fitsImage(tileset, image.width, image.height) : true;
  const sizeChanged = width !== tileset.tileWidth || height !== tileset.tileHeight;
  const preview = image && valid ? tileGrid(image.width, image.height, width, height) : null;

  const recut = async () => {
    if (!image || !valid) return;
    const next = fitTileset(tileset, image.width, image.height, width, height);
    const reindexes = next.columns !== tileset.columns || next.tiles.length < tileset.tiles.length;
    if (reindexes && users.length > 0) {
      const ok = await confirmAction(
        `Maps using this tileset (${users.join(', ')}) will show different tiles where the grid changes. Cut the image into ${next.columns} × ${Math.ceil(next.tiles.length / next.columns)} tiles anyway?`,
        { title: 'Change the tile grid', okLabel: 'Change grid' },
      );
      if (!ok) return;
    }
    doc.update(file.path, 'tileset', 'Change tile grid', () => next);
  };

  return (
    <section>
      <h2>Image and grid</h2>
      <p className="hint">
        Tileset id <code>{tileset.id}</code>{' '}
        <RenameIdButton doc={doc} kind="tileset" id={tileset.id} what="tileset" />
      </p>
      <label className="field">
        <span>Image</span>
        <select
          value={tileset.image}
          onChange={(e) => {
            const image = e.target.value;
            doc.update(file.path, 'tileset', 'Change tileset image', (t) => ({ ...t, image }));
          }}
        >
          {[...new Set([tileset.image, ...images])].sort().map((p) => (
            <option key={p} value={p}>
              {p.replace(/^assets\//, '')}
            </option>
          ))}
        </select>
      </label>
      {image && (
        <p className="muted small">
          {image.width} × {image.height} px · {tileset.columns} columns · {tileset.tiles.length}{' '}
          tiles
        </p>
      )}
      <div className="row">
        <label className="field">
          <span>Tile width</span>
          <input
            type="number"
            min={1}
            value={Number.isFinite(width) ? width : ''}
            onChange={(e) => setWidth(e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          <span>Tile height</span>
          <input
            type="number"
            min={1}
            value={Number.isFinite(height) ? height : ''}
            onChange={(e) => setHeight(e.target.valueAsNumber)}
          />
        </label>
      </div>
      {!fits && !sizeChanged && (
        <p className="error">
          The grid doesn't match the image (it holds{' '}
          {preview && `${preview.columns} × ${preview.rows}`} tiles). Re-cut it to fit.
        </p>
      )}
      {(sizeChanged || !fits) && (
        <button disabled={!image || !valid} onClick={() => void recut()}>
          {preview ? `Cut into ${preview.columns} × ${preview.rows} tiles` : 'Cut into tiles'}
        </button>
      )}
      <p className="hint">
        {users.length > 0 ? `Used by ${users.join(', ')}.` : 'No map uses this tileset yet.'} Tiles
        keep their flags and names by position when the grid changes.
      </p>
    </section>
  );
}
