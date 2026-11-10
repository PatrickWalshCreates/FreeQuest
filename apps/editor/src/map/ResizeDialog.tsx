import { type Anchor, type ProjectDocument, applyResize, resizeMap } from '@freequest/editor-core';
import type { GameMap } from '@freequest/schema';
import { useState } from 'react';
import { Dialog, Field } from '../Dialog.js';
import { SizeInput } from './NewMapDialog.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly map: GameMap;
  readonly onClose: () => void;
}

const STEPS = [0, 0.5, 1] as const;
const ANCHOR_LABELS = [
  ['top left', 'top', 'top right'],
  ['left', 'center', 'right'],
  ['bottom left', 'bottom', 'bottom right'],
];

/** Change a map's size, choosing which side stays put. */
export function ResizeDialog({ doc, map, onClose }: Props) {
  const [width, setWidth] = useState(map.width);
  const [height, setHeight] = useState(map.height);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0 });
  let preview: ReturnType<typeof resizeMap> | null = null;
  let error: string | null = null;
  try {
    preview = resizeMap(map, width, height, anchor);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const dropped = preview?.droppedEvents ?? [];

  return (
    <Dialog title={`Resize ${map.name}`} onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!preview) return;
          applyResize(doc, map.id, width, height, anchor);
          onClose();
        }}
      >
        <div className="row">
          <Field label="Width (tiles)">
            <SizeInput value={width} onChange={setWidth} />
          </Field>
          <Field label="Height (tiles)">
            <SizeInput value={height} onChange={setHeight} />
          </Field>
          <div className="field">
            <span>Keep in place</span>
            <div className="anchor-grid" role="radiogroup" aria-label="Anchor">
              {STEPS.map((y, row) =>
                STEPS.map((x, column) => {
                  const on = anchor.x === x && anchor.y === y;
                  const label = ANCHOR_LABELS[row]?.[column] ?? '';
                  return (
                    <button
                      key={`${x},${y}`}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={label}
                      title={label}
                      className={on ? 'on' : undefined}
                      onClick={() => setAnchor({ x, y })}
                    />
                  );
                }),
              )}
            </div>
          </div>
        </div>
        <p className="hint">
          {map.width} × {map.height} → {Number.isFinite(width) ? width : '?'} ×{' '}
          {Number.isFinite(height) ? height : '?'}. New ground repeats the edge tiles; doors into
          this map and the start position move with the content.
        </p>
        {dropped.length > 0 && (
          <p className="error">
            {dropped.length === 1 ? 'This event falls' : 'These events fall'} outside the new size
            and will be removed: {dropped.map((e) => e.name).join(', ')}
          </p>
        )}
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!preview}>
            Resize
          </button>
        </div>
      </form>
    </Dialog>
  );
}
