// Where a troop's enemies stand in battle (M16 step 2): the battle screen at
// the game's size, its background, and the enemies to drag into place. Uses
// core's `enemyPlaces`, so it shows what the game will.
import { type TroopPlace, enemyPlaces } from '@freequest/core';
import type { ProjectDocument } from '@freequest/editor-core';
import { useRef } from 'react';
import { useLoaded } from '../map/graphics.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly enemies: readonly string[];
  readonly places: readonly TroopPlace[] | undefined;
  /** `undefined`: back to the automatic row. Called as a drag goes on (one undo step until `onDragEnd`). */
  readonly onChange: (places: readonly TroopPlace[] | undefined) => void;
  readonly onDragEnd: () => void;
}

/** The widest the layout is drawn, in CSS pixels. */
const MAX_WIDTH = 520;

export function TroopLayout({ doc, enemies, places, onChange, onDragEnd }: Props) {
  const project = doc.project;
  const { width, height } = project.manifest.data.screen;
  const scale = Math.min(1, MAX_WIDTH / width);
  const background = project.database.system?.data?.battleBackground ?? null;
  const entries = project.database.enemies?.data?.entries ?? [];
  const shown = enemyPlaces(enemies.length, width, height, places);
  const own = places !== undefined && places.length === enemies.length;
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const backgroundUrl = useLoaded(`${background ?? ''}:${doc.assets.version}`, () =>
    background ? doc.fs.assetUrl(background) : Promise.resolve(null),
  );
  const imageKey = enemies.join(',') + `:${doc.assets.version}`;
  const images = useLoaded(imageKey, () =>
    Promise.all(
      enemies.map((id) => {
        const image = entries.find((e) => e.id === id)?.image;
        return image ? doc.fs.assetUrl(image).catch(() => null) : Promise.resolve(null);
      }),
    ),
  );

  const placeAt = (index: number, event: React.PointerEvent) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.round((event.clientX - rect.left) / scale);
    const y = Math.round((event.clientY - rect.top) / scale);
    const clamp = (v: number, max: number) => Math.min(max, Math.max(0, v));
    onChange(shown.map((p, i) => (i === index ? { x: clamp(x, width), y: clamp(y, height) } : p)));
  };

  return (
    <section className="troop-layout">
      <h3>In battle</h3>
      <p className="hint">
        Drag the enemies to where they stand (their feet).{' '}
        {own ? '' : 'They stand in an even row until you move one.'}
      </p>
      {places !== undefined && !own && (
        <p className="error">
          The troop has {enemies.length} enemies but {places.length} places: they stand in the row.
          Move one to set them all again.
        </p>
      )}
      <div
        ref={box}
        className={
          backgroundUrl.status === 'ready' && backgroundUrl.value ? 'stage' : 'stage plain'
        }
        style={{
          width: width * scale,
          height: height * scale,
          ...(backgroundUrl.status === 'ready' && backgroundUrl.value
            ? { backgroundImage: `url("${backgroundUrl.value}")` }
            : {}),
        }}
      >
        {shown.map((place, i) => {
          const url = images.status === 'ready' ? images.value[i] : null;
          const name = entries.find((e) => e.id === enemies[i])?.name ?? enemies[i] ?? '';
          return (
            <div
              key={i}
              className="troop-enemy"
              title={`${i + 1}. ${name} (${place.x}, ${place.y})`}
              style={{ left: place.x * scale, top: place.y * scale }}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                dragging.current = i;
              }}
              onPointerMove={(event) => {
                if (dragging.current === i) placeAt(i, event);
              }}
              onPointerUp={() => {
                dragging.current = null;
                onDragEnd();
              }}
            >
              {url ? (
                <img
                  src={url}
                  alt={name}
                  draggable={false}
                  style={{
                    transform: `translate(-50%, -100%) scale(${scale})`,
                    transformOrigin: '50% 100%',
                  }}
                />
              ) : (
                <span className="troop-placeholder">?</span>
              )}
              <span className="troop-number">{i + 1}</span>
            </div>
          );
        })}
      </div>
      {own && (
        <button className="small" onClick={() => onChange(undefined)}>
          Back to an even row
        </button>
      )}
    </section>
  );
}
