// A message's face: pick a face sheet (one row of square faces, as tall as
// the image) and click the face. Also draws one face for the message preview.
import type { ProjectDocument } from '@freequest/editor-core';
import { type MessageFace, faceSheetLayout } from '@freequest/schema';
import { type ImageInfo, useImage } from '../tileset/image-size.js';

/** One face of a loaded sheet, drawn crisply at `scale` (a CSS sprite). */
export function FaceImage(props: {
  readonly image: ImageInfo;
  readonly index: number;
  readonly scale?: number;
}) {
  const { image, index } = props;
  const scale = props.scale ?? 1;
  const { size } = faceSheetLayout(image.width, image.height);
  const shown = size * scale;
  return (
    <span
      className="face-image"
      aria-hidden
      style={{
        width: shown,
        height: shown,
        backgroundImage: `url("${image.url}")`,
        backgroundSize: `${image.width * scale}px ${image.height * scale}px`,
        backgroundPosition: `${-index * shown}px 0`,
      }}
    />
  );
}

/** A face sheet's image with its layout, or why it can't be shown. */
export function useFaceSheet(doc: ProjectDocument, path: string | null) {
  const image = useImage(doc, path);
  if (!path) return { status: 'none' as const };
  if (image.status === 'error') return { status: 'missing' as const };
  if (image.status !== 'ready' || !image.value) return { status: 'loading' as const };
  return {
    status: 'ready' as const,
    image: image.value,
    count: faceSheetLayout(image.value.width, image.value.height).count,
  };
}

export function FaceField(props: {
  readonly doc: ProjectDocument;
  /** Image files in the project; those under assets/faces/ are offered first. */
  readonly images: readonly string[];
  readonly value: MessageFace | undefined;
  readonly onChange: (value: MessageFace | undefined) => void;
}) {
  const { value, onChange } = props;
  const sheet = useFaceSheet(props.doc, value?.image ?? null);
  const faces = props.images.filter((p) => p.startsWith('assets/faces/'));
  const others = props.images.filter((p) => !p.startsWith('assets/faces/'));
  const name = (p: string) => p.replace(/^assets\//, '');
  return (
    <div className="face-field">
      <select
        value={value?.image ?? ''}
        onChange={(e) =>
          onChange(e.target.value === '' ? undefined : { image: e.target.value, index: 0 })
        }
      >
        <option value="">(no face)</option>
        {value && !props.images.includes(value.image) && (
          <option value={value.image}>{name(value.image)} (missing)</option>
        )}
        {faces.length > 0 && (
          <optgroup label="Faces">
            {faces.map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Other images">
            {others.map((p) => (
              <option key={p} value={p}>
                {name(p)}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {value && sheet.status === 'ready' && sheet.count > 0 && (
        <div className="face-choices" role="listbox" aria-label="Faces">
          {Array.from({ length: sheet.count }, (_, i) => (
            <button
              key={i}
              type="button"
              role="option"
              aria-selected={i === value.index}
              className={i === value.index ? 'face-cell selected' : 'face-cell'}
              title={`Face ${i}`}
              onClick={() => onChange({ image: value.image, index: i })}
            >
              <FaceImage image={sheet.image} index={i} />
            </button>
          ))}
        </div>
      )}
      {value && sheet.status === 'ready' && sheet.count === 0 && (
        <p className="hint">
          This image is taller than it is wide: a face sheet is a row of square faces, as tall as
          the image.
        </p>
      )}
      {value && sheet.status === 'ready' && sheet.count > 0 && value.index >= sheet.count && (
        <p className="error">
          Face {value.index} isn’t in this image (it has {sheet.count}): pick one above.
        </p>
      )}
      {sheet.status === 'missing' && <p className="error">This image is missing.</p>}
      {!value && (
        <p className="hint">
          Optional. A face sheet is a row of square faces as tall as the image, e.g. four 48 × 48
          faces in a 192 × 48 picture (import them into the Faces folder).
        </p>
      )}
    </div>
  );
}
