// Icons from the game's iconset (system.json): a CSS-sprite view of one
// icon, and a field that picks one from a grid of the whole sheet.
import type { ProjectDocument } from '@freequest/editor-core';
import { useState } from 'react';
import { type ImageInfo, useImage } from '../tileset/image-size.js';

export interface Iconset {
  readonly image: ImageInfo;
  readonly size: number;
  readonly columns: number;
  /** Icons the image actually holds. */
  readonly count: number;
}

/** The project's iconset with its image loaded, or null (none declared, or still loading). */
export function useIconset(doc: ProjectDocument): Iconset | null | 'missing' {
  const declared = doc.project.database.system?.data?.iconset;
  const image = useImage(doc, declared?.image ?? null);
  if (!declared) return null;
  if (image.status === 'error') return 'missing';
  if (image.status !== 'ready' || !image.value) return null;
  const columns = Math.min(declared.columns, Math.floor(image.value.width / declared.iconSize));
  const rows = Math.floor(image.value.height / declared.iconSize);
  return { image: image.value, size: declared.iconSize, columns, count: columns * rows };
}

/** One icon, drawn crisply at `scale`. */
export function IconImage(props: {
  readonly icons: Iconset;
  readonly index: number;
  readonly scale?: number;
}) {
  const { icons, index } = props;
  const scale = props.scale ?? 2;
  const size = icons.size * scale;
  return (
    <span
      className="icon-image"
      aria-hidden
      style={{
        width: size,
        height: size,
        backgroundImage: `url("${icons.image.url}")`,
        backgroundSize: `${icons.image.width * scale}px ${icons.image.height * scale}px`,
        backgroundPosition: `${-(index % icons.columns) * size}px ${-Math.floor(index / icons.columns) * size}px`,
      }}
    />
  );
}

/** Pick an entry's icon from the iconset (or none). Without an iconset it's a plain number. */
export function IconField(props: {
  readonly doc: ProjectDocument;
  readonly value: number | undefined;
  readonly onChange: (value: number | undefined) => void;
}) {
  const { value, onChange } = props;
  const icons = useIconset(props.doc);
  const [open, setOpen] = useState(false);
  if (icons === null || icons === 'missing') {
    return (
      <div className="icon-field">
        <input
          type="number"
          min={0}
          step={1}
          value={value ?? ''}
          placeholder="(none)"
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            onChange(Number.isInteger(n) && n >= 0 ? n : undefined);
          }}
        />
        <span className="hint">
          {icons === 'missing'
            ? 'The iconset image is missing: check System → iconset.'
            : 'Set an iconset in System to pick icons from a picture.'}
        </span>
      </div>
    );
  }
  return (
    <div className="icon-field">
      <div className="icon-current">
        {value !== undefined && value < icons.count ? (
          <IconImage icons={icons} index={value} />
        ) : (
          <span className="icon-none">{value === undefined ? 'None' : `#${value}?`}</span>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Close' : 'Choose…'}
        </button>
        {value !== undefined && (
          <button type="button" onClick={() => onChange(undefined)}>
            No icon
          </button>
        )}
      </div>
      {open && (
        <div
          className="icon-grid"
          role="listbox"
          aria-label="Icons"
          style={{ gridTemplateColumns: `repeat(${icons.columns}, auto)` }}
        >
          {Array.from({ length: icons.count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === value}
              className={i === value ? 'icon-cell selected' : 'icon-cell'}
              title={`Icon ${i}`}
              onClick={() => {
                onChange(i);
                setOpen(false);
              }}
            >
              <IconImage icons={icons} index={i} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
