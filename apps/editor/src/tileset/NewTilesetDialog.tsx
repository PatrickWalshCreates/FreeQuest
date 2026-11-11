import { type ProjectDocument, createTileset, tileGrid } from '@freequest/editor-core';
import { useState } from 'react';
import { Dialog, Field } from '../Dialog.js';
import { useProjectLists } from '../forms/use-project-lists.js';
import { useImage } from './image-size.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly onClose: () => void;
  /** Called with the new tileset's id. */
  readonly onCreated: (id: string) => void;
  /** Opens the Assets panel (when there's no image to use yet). */
  readonly onImport: () => void;
}

const imageName = (path: string) =>
  (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** `base`, or "base 2", "base 3"… whichever no tileset is called yet. */
function freeName(doc: ProjectDocument, base: string): string {
  const names = new Set([...doc.project.tilesets.values()].map((t) => t.data?.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!names.has(name)) return name;
  }
}

/** A new tileset cut from an image under assets/ (Tilesets folder first). */
export function NewTilesetDialog({ doc, onClose, onCreated, onImport }: Props) {
  const images = useProjectLists(doc).images ?? [];
  const sorted = [...images].sort(
    (a, b) =>
      Number(!a.startsWith('assets/tilesets/')) - Number(!b.startsWith('assets/tilesets/')) ||
      a.localeCompare(b),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const path = picked ?? sorted[0] ?? null;
  const [name, setName] = useState<string | null>(null);
  const [tileWidth, setTileWidth] = useState(32);
  const [tileHeight, setTileHeight] = useState(32);
  const [error, setError] = useState<string | null>(null);
  const image = useImage(doc, path);
  const info = image.status === 'ready' ? image.value : null;
  const shownName = name ?? (path ? freeName(doc, titleCase(imageName(path))) : '');
  const valid = tileWidth > 0 && tileHeight > 0 && Number.isInteger(tileWidth + tileHeight);
  const grid = info && valid ? tileGrid(info.width, info.height, tileWidth, tileHeight) : null;

  if (sorted.length === 0) {
    return (
      <Dialog title="New tileset" onClose={onClose}>
        <p>A tileset is cut from an image, and this project has no images yet.</p>
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary" onClick={onImport}>
            Import an image…
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="New tileset" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!path || !info) return;
          try {
            onCreated(
              createTileset(doc, {
                name: shownName,
                image: path,
                imageWidth: info.width,
                imageHeight: info.height,
                tileWidth,
                tileHeight,
              }),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <Field label="Image">
          <select value={path ?? ''} onChange={(e) => setPicked(e.target.value)}>
            {sorted.map((p) => (
              <option key={p} value={p}>
                {p.replace(/^assets\//, '')}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Name">
          <input value={shownName} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <Field label="Tile width (px)">
            <input
              type="number"
              min={1}
              value={Number.isFinite(tileWidth) ? tileWidth : ''}
              onChange={(e) => setTileWidth(e.target.valueAsNumber)}
            />
          </Field>
          <Field label="Tile height (px)">
            <input
              type="number"
              min={1}
              value={Number.isFinite(tileHeight) ? tileHeight : ''}
              onChange={(e) => setTileHeight(e.target.valueAsNumber)}
            />
          </Field>
        </div>
        {image.status === 'error' && <p className="error">{image.message}</p>}
        {info && (
          <p className="hint">
            {info.width} × {info.height} px
            {grid && ` → ${grid.columns} × ${grid.rows} = ${grid.columns * grid.rows} tiles`}, all
            walkable to start with.
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!info || !valid}>
            Create tileset
          </button>
        </div>
      </form>
    </Dialog>
  );
}
