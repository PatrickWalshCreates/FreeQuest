// A picture chosen from the project's images, with a small preview: battle
// backgrounds (Database › System, map settings, a battle command's own).
import type { ProjectDocument } from '@freequest/editor-core';
import { useLoaded } from '../map/graphics.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly images: readonly string[];
  readonly value: string | undefined;
  /** `undefined` when "none" is chosen. */
  readonly onChange: (value: string | undefined) => void;
  /** What "none" means here, e.g. "(the project’s)". */
  readonly noneLabel: string;
  readonly title?: string;
}

export function BackgroundPicker({ doc, images, value, onChange, noneLabel, title }: Props) {
  // Pictures in assets/battlebacks first, then every other image.
  const first = (p: string) => (p.startsWith('assets/battlebacks/') ? 0 : 1);
  const options = [...new Set([...images, ...(value ? [value] : [])])].sort(
    (a, b) => first(a) - first(b) || a.localeCompare(b),
  );
  const url = useLoaded(`${value ?? ''}:${doc.assets.version}`, () =>
    value ? doc.fs.assetUrl(value) : Promise.resolve(null),
  );
  return (
    <span className="background-picker">
      <select
        value={value ?? ''}
        {...(title ? { title } : {})}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">{noneLabel}</option>
        {options.map((p) => (
          <option key={p} value={p}>
            {p.replace(/^assets\//, '')}
            {images.includes(p) ? '' : ' (missing)'}
          </option>
        ))}
      </select>
      {url.status === 'ready' && url.value && (
        <img className="background-preview" src={url.value} alt="" />
      )}
    </span>
  );
}
