// Animations and balloons in the editor: a balloon picker by name (for the
// Show balloon command), and a looping preview of an animation entry.
import type { ProjectDocument } from '@freequest/editor-core';
import type { AnimationEntry } from '@freequest/schema';
import { useEffect, useRef } from 'react';
import { useImage } from '../tileset/image-size.js';

/** Pick a balloon by its name (rows of the balloon image, Database › System). */
export function BalloonField(props: {
  readonly names: readonly string[];
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  const { names, value, onChange } = props;
  if (names.length === 0) {
    return (
      <p className="hint">
        No balloons yet: set a balloon image under Database › System › Balloons.
      </p>
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(Number(e.target.value))}>
      {value >= names.length && <option value={value}>#{value} (not in the balloon image)</option>}
      {names.map((name, i) => (
        <option key={i} value={i}>
          {name}
        </option>
      ))}
    </select>
  );
}

const PREVIEW_SCALE = 3;

/** An animation's frames played over and over at its speed (with a pause between loops). */
export function AnimationPreview(props: {
  readonly doc: ProjectDocument;
  readonly entry: AnimationEntry;
}) {
  const { doc, entry } = props;
  const image = useImage(doc, entry.image ?? null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const loaded = image.status === 'ready' ? image.value : null;

  useEffect(() => {
    const target = canvas.current;
    const context = target?.getContext('2d');
    if (!target || !context || !loaded) return;
    const picture = new Image();
    picture.src = loaded.url;
    const columns = Math.max(1, Math.floor(loaded.width / entry.frameWidth));
    const seconds = entry.frames / entry.fps;
    const start = performance.now();
    let handle = 0;
    const draw = (now: number) => {
      // Each loop plays the animation, then shows nothing for half a second.
      const t = ((now - start) / 1000) % (seconds + 0.5);
      context.clearRect(0, 0, target.width, target.height);
      context.imageSmoothingEnabled = false;
      if (t < seconds) {
        const frame = Math.min(entry.frames - 1, Math.floor(t * entry.fps));
        context.drawImage(
          picture,
          (frame % columns) * entry.frameWidth,
          Math.floor(frame / columns) * entry.frameHeight,
          entry.frameWidth,
          entry.frameHeight,
          0,
          0,
          entry.frameWidth * PREVIEW_SCALE,
          entry.frameHeight * PREVIEW_SCALE,
        );
      }
      handle = requestAnimationFrame(draw);
    };
    handle = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(handle);
  }, [loaded, entry.frameWidth, entry.frameHeight, entry.frames, entry.fps]);

  const seconds = Math.round((entry.frames / entry.fps) * 100) / 100;
  return (
    <div className="animation-preview">
      {!entry.image ? (
        <p className="hint">
          No image yet: it plays its sounds and takes {seconds} s, but shows nothing. Choose an
          image of frames (left to right, then down) to draw it.
        </p>
      ) : image.status === 'error' ? (
        <p className="error">{image.message}</p>
      ) : (
        <>
          <canvas
            ref={canvas}
            width={entry.frameWidth * PREVIEW_SCALE}
            height={entry.frameHeight * PREVIEW_SCALE}
            aria-label={`Preview of ${entry.name}`}
          />
          <p className="hint">
            {entry.frames} frames at {entry.fps} per second: {seconds} s.
          </p>
        </>
      )}
    </div>
  );
}
