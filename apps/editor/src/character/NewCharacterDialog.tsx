import { type ProjectDocument, createCharacter, frameGrid } from '@freequest/editor-core';
import { useState } from 'react';
import { Dialog, Field } from '../Dialog.js';
import { useProjectLists } from '../forms/use-project-lists.js';
import { useImage } from '../tileset/image-size.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly onClose: () => void;
  /** Called with the new character's id. */
  readonly onCreated: (id: string) => void;
  /** Opens the Assets panel (when there's no image to use yet). */
  readonly onImport: () => void;
}

const imageName = (path: string) =>
  (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** `base`, or "base 2", "base 3"… whichever no character is called yet. */
function freeName(doc: ProjectDocument, base: string): string {
  const names = new Set([...doc.project.characters.values()].map((c) => c.data?.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!names.has(name)) return name;
  }
}

/** A new character sheet cut from an image under assets/ (Characters folder first). */
export function NewCharacterDialog({ doc, onClose, onCreated, onImport }: Props) {
  const images = useProjectLists(doc).images ?? [];
  const sorted = [...images].sort(
    (a, b) =>
      Number(!a.startsWith('assets/characters/')) - Number(!b.startsWith('assets/characters/')) ||
      a.localeCompare(b),
  );
  const [picked, setPicked] = useState<string | null>(null);
  const path = picked ?? sorted[0] ?? null;
  const [name, setName] = useState<string | null>(null);
  const [frameWidth, setFrameWidth] = useState(32);
  const [frameHeight, setFrameHeight] = useState(32);
  const [error, setError] = useState<string | null>(null);
  const image = useImage(doc, path);
  const info = image.status === 'ready' ? image.value : null;
  const shownName = name ?? (path ? freeName(doc, titleCase(imageName(path))) : '');
  const valid =
    Number.isInteger(frameWidth) &&
    Number.isInteger(frameHeight) &&
    frameWidth > 0 &&
    frameHeight > 0;
  const grid = info && valid ? frameGrid(info.width, info.height, frameWidth, frameHeight) : null;

  if (sorted.length === 0) {
    return (
      <Dialog title="New character" onClose={onClose}>
        <p>A character is cut from a sprite sheet image, and this project has no images yet.</p>
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
    <Dialog title="New character" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!path || !info) return;
          try {
            onCreated(
              createCharacter(doc, {
                name: shownName,
                image: path,
                imageWidth: info.width,
                imageHeight: info.height,
                frameWidth,
                frameHeight,
              }),
            );
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <Field label="Sprite sheet">
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
          <Field label="Frame width (px)">
            <input
              type="number"
              min={1}
              value={Number.isFinite(frameWidth) ? frameWidth : ''}
              onChange={(e) => setFrameWidth(e.target.valueAsNumber)}
            />
          </Field>
          <Field label="Frame height (px)">
            <input
              type="number"
              min={1}
              value={Number.isFinite(frameHeight) ? frameHeight : ''}
              onChange={(e) => setFrameHeight(e.target.valueAsNumber)}
            />
          </Field>
        </div>
        {image.status === 'error' && <p className="error">{image.message}</p>}
        {info && grid && (
          <p className={grid.rows < 4 ? 'error' : 'hint'}>
            {info.width} × {info.height} px →{' '}
            {grid.rows < 4
              ? `only ${grid.rows} row${grid.rows === 1 ? '' : 's'} of frames; a sheet needs 4 (down, left, right, up).`
              : `${grid.frames} frames per direction. Rows are read as down, left, right, up; change that after creating it.`}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!info || !grid || grid.rows < 4}>
            Create character
          </button>
        </div>
      </form>
    </Dialog>
  );
}
