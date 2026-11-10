import { MAX_MAP_SIZE, type ProjectDocument, createMap } from '@freequest/editor-core';
import { useState } from 'react';
import { Dialog, Field } from '../Dialog.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly onClose: () => void;
  /** Called with the new map's id. */
  readonly onCreated: (id: string) => void;
}

export function NewMapDialog({ doc, onClose, onCreated }: Props) {
  const tilesets = [...doc.project.tilesets].filter(([, file]) => file.data);
  const [name, setName] = useState('New map');
  const [width, setWidth] = useState(20);
  const [height, setHeight] = useState(15);
  const [tileset, setTileset] = useState(tilesets[0]?.[0] ?? '');
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog title="New map" onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            onCreated(createMap(doc, { name: name.trim() || 'New map', width, height, tileset }));
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <div className="row">
          <Field label="Width (tiles)">
            <SizeInput value={width} onChange={setWidth} />
          </Field>
          <Field label="Height (tiles)">
            <SizeInput value={height} onChange={setHeight} />
          </Field>
        </div>
        <Field label="Tileset">
          <select value={tileset} onChange={(e) => setTileset(e.target.value)}>
            {tilesets.map(([id, file]) => (
              <option key={id} value={id}>
                {file.data?.name ?? id}
              </option>
            ))}
          </select>
        </Field>
        <p className="hint">The ground is filled with the tileset’s first tile.</p>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!tileset}>
            Create map
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SizeInput(props: {
  readonly value: number;
  readonly onChange: (n: number) => void;
}) {
  return (
    <input
      type="number"
      min={1}
      max={MAX_MAP_SIZE}
      step={1}
      value={Number.isFinite(props.value) ? props.value : ''}
      onChange={(e) => props.onChange(e.target.valueAsNumber)}
    />
  );
}
