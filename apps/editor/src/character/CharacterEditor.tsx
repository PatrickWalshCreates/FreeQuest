// The character sheet editor: the image cut into frames with each row's
// direction, a walking preview at the game's speed, and the sheet's
// settings (row order, standing frame, walk cycle, frame size, image).
// Edits are pure functions in editor-core/character-edits.ts.
import {
  type ProjectDocument,
  type ProjectFile,
  characterUsages,
  fitCharacter,
  frameGrid,
  moveRow,
  parseFrameList,
  sheetImageProblem,
} from '@freequest/editor-core';
import { FRAMES_PER_TILE } from '@freequest/runtime';
import type { CharacterSheet, Direction } from '@freequest/schema';
import { useEffect, useRef, useState } from 'react';
import { useProjectLists } from '../forms/use-project-lists.js';
import { confirmAction } from '../platform.js';
import { type ImageInfo, useImage } from '../tileset/image-size.js';
import { useElementSize } from '../use-element-size.js';
import { RenameIdButton } from '../RenameIdButton.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<'character'> & { readonly data: CharacterSheet };
}

const DIRECTIONS: readonly Direction[] = ['down', 'left', 'right', 'up'];
const ARROWS: Readonly<Record<Direction, string>> = { down: '↓', left: '←', right: '→', up: '↑' };

export function CharacterEditor({ doc, file }: Props) {
  const sheet = file.data;
  const image = useImage(doc, sheet.image);
  const info = image.status === 'ready' ? image.value : null;
  const change = (label: string, fn: (c: CharacterSheet) => CharacterSheet, coalesce?: string) =>
    doc.update(file.path, 'character', label, fn, coalesce ? { coalesce } : {});
  const problem = info ? sheetImageProblem(sheet, info.width, info.height) : null;
  const canvas = useRef<HTMLDivElement>(null);
  const space = useElementSize(canvas, 16);
  // The largest whole zoom that fits the sheet (plus its labels) under the preview.
  const scale = info
    ? ([6, 4, 3, 2].find(
        (z) => info.width * z + 72 <= space.width && info.height * z + 24 <= space.height - 200,
      ) ?? 1)
    : 1;

  return (
    <div className="tileset-editor">
      <div className="tileset-main">
        <div className="tileset-canvas character-canvas" ref={canvas}>
          {image.status === 'loading' && <p className="muted">Loading image…</p>}
          {image.status === 'error' && <p className="error">{image.message}</p>}
          {problem && <p className="error">{problem}</p>}
          {info && (
            <div className="sheet-layout">
              {!problem && (
                <WalkPreview
                  sheet={sheet}
                  image={info}
                  speed={doc.project.manifest.data.player.speed}
                />
              )}
              <SheetGrid sheet={sheet} image={info} scale={scale} />
            </div>
          )}
        </div>
      </div>
      <aside className="map-side tileset-side">
        <section>
          <h2>Directions</h2>
          <p className="hint">Which way each row of the image faces, top to bottom.</p>
          <ol className="row-order">
            {sheet.rows.map((direction, i) => (
              <li key={direction}>
                <span>
                  Row {i + 1}: {ARROWS[direction]} {direction}
                </span>
                <button
                  title="Move up"
                  aria-label={`Move ${direction} up`}
                  disabled={i === 0}
                  onClick={() => change('Reorder rows', (c) => moveRow(c, i, -1))}
                >
                  ↑
                </button>
                <button
                  title="Move down"
                  aria-label={`Move ${direction} down`}
                  disabled={i === sheet.rows.length - 1}
                  onClick={() => change('Reorder rows', (c) => moveRow(c, i, 1))}
                >
                  ↓
                </button>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2>Animation</h2>
          <label className="field">
            <span>Standing frame</span>
            <select
              value={sheet.idleFrame}
              onChange={(e) => {
                const idleFrame = Number(e.target.value);
                change('Set standing frame', (c) => ({ ...c, idleFrame }));
              }}
            >
              {Array.from({ length: sheet.frames }, (_, f) => (
                <option key={f} value={f}>
                  Frame {f}
                </option>
              ))}
            </select>
          </label>
          <WalkCycleField
            key={`${sheet.walkCycle.join(' ')}:${sheet.frames}`}
            sheet={sheet}
            onChange={(walkCycle) => change('Set walk cycle', (c) => ({ ...c, walkCycle }))}
          />
        </section>
        <FrameSettings
          key={`${sheet.frameWidth}x${sheet.frameHeight}`}
          doc={doc}
          file={file}
          image={info}
        />
      </aside>
    </div>
  );
}

/** The sheet image with its frame grid, frame numbers on top and directions down the side. */
function SheetGrid(props: {
  readonly sheet: CharacterSheet;
  readonly image: ImageInfo;
  readonly scale: number;
}) {
  const { sheet, image, scale } = props;
  const fw = sheet.frameWidth * scale;
  const fh = sheet.frameHeight * scale;
  return (
    <div
      className="sheet-grid"
      style={{
        gridTemplateColumns: `auto repeat(${sheet.frames}, ${fw}px)`,
        gridTemplateRows: `auto repeat(4, ${fh}px)`,
      }}
    >
      <span />
      {Array.from({ length: sheet.frames }, (_, f) => (
        <span key={f} className={f === sheet.idleFrame ? 'frame-number idle' : 'frame-number'}>
          {f}
          {f === sheet.idleFrame ? ' ●' : ''}
        </span>
      ))}
      {sheet.rows.map((direction, row) => (
        <Row key={direction} {...{ sheet, image, scale, direction, row }} />
      ))}
    </div>
  );
}

function Row(props: {
  readonly sheet: CharacterSheet;
  readonly image: ImageInfo;
  readonly scale: number;
  readonly direction: Direction;
  readonly row: number;
}) {
  const { sheet, image, scale, direction, row } = props;
  return (
    <>
      <span className="row-label">
        {ARROWS[direction]} {direction}
      </span>
      {Array.from({ length: sheet.frames }, (_, f) => (
        <Frame
          key={f}
          {...{ sheet, image, scale, row, column: f }}
          className={f === sheet.idleFrame ? 'sheet-frame idle' : 'sheet-frame'}
        />
      ))}
    </>
  );
}

/** One frame of the sheet, cut out of the image with CSS. */
function Frame(props: {
  readonly sheet: CharacterSheet;
  readonly image: ImageInfo;
  readonly scale: number;
  readonly row: number;
  readonly column: number;
  readonly className?: string;
}) {
  const { sheet, image, scale, row, column } = props;
  return (
    <div
      className={props.className}
      style={{
        width: sheet.frameWidth * scale,
        height: sheet.frameHeight * scale,
        backgroundImage: `url("${image.url}")`,
        backgroundSize: `${image.width * scale}px ${image.height * scale}px`,
        backgroundPosition: `${-column * sheet.frameWidth * scale}px ${-row * sheet.frameHeight * scale}px`,
      }}
    />
  );
}

/** All four directions walking (or standing) at the player's speed, as in the game. */
function WalkPreview(props: {
  readonly sheet: CharacterSheet;
  readonly image: ImageInfo;
  readonly speed: number;
}) {
  const { sheet, image, speed } = props;
  const [walking, setWalking] = useState(true);
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!walking) return;
    const timer = window.setInterval(
      () => setStep((s) => s + 1),
      1000 / Math.max(0.5, speed * FRAMES_PER_TILE),
    );
    return () => window.clearInterval(timer);
  }, [walking, speed]);
  const column = walking
    ? (sheet.walkCycle[step % sheet.walkCycle.length] ?? sheet.idleFrame)
    : sheet.idleFrame;
  const scale = Math.max(2, Math.min(4, Math.floor(96 / sheet.frameHeight)));
  return (
    <div className="walk-preview">
      <h3>Preview</h3>
      <div className="walk-figures">
        {DIRECTIONS.map((direction) => {
          const row = sheet.rows.indexOf(direction);
          return (
            <figure key={direction}>
              <Frame {...{ sheet, image, scale, row, column }} className="preview-frame" />
              <figcaption>
                {ARROWS[direction]} {direction}
              </figcaption>
            </figure>
          );
        })}
      </div>
      <label className="toggle">
        <input type="checkbox" checked={walking} onChange={(e) => setWalking(e.target.checked)} />
        Walking
      </label>
      <p className="muted small">
        Frame {column} · {speed} tiles/s (the player's speed)
      </p>
    </div>
  );
}

function WalkCycleField(props: {
  readonly sheet: CharacterSheet;
  readonly onChange: (cycle: number[]) => void;
}) {
  const [text, setText] = useState(props.sheet.walkCycle.join(' '));
  const parsed = parseFrameList(text, props.sheet.frames);
  const commit = () => {
    if ('value' in parsed && parsed.value.join(' ') !== props.sheet.walkCycle.join(' ')) {
      props.onChange(parsed.value);
    }
  };
  return (
    <label className="field">
      <span>Walk cycle</span>
      <input
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
      {'problem' in parsed ? (
        <span className="error-text small">{parsed.problem}</span>
      ) : (
        <span className="hint">Frames shown in turn while walking, e.g. 0 1 2 1.</span>
      )}
    </label>
  );
}

/** Image and frame size. */
function FrameSettings(props: {
  readonly doc: ProjectDocument;
  readonly file: Props['file'];
  readonly image: ImageInfo | null;
}) {
  const { doc, file, image } = props;
  const sheet = file.data;
  const images = useProjectLists(doc).images ?? [];
  const [width, setWidth] = useState(sheet.frameWidth);
  const [height, setHeight] = useState(sheet.frameHeight);
  const valid = Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0;
  const changed = width !== sheet.frameWidth || height !== sheet.frameHeight;
  const fitted =
    image && valid ? fitCharacter(sheet, image.width, image.height, width, height) : null;
  const grid = image && valid ? frameGrid(image.width, image.height, width, height) : null;
  const uses = characterUsages(doc.project, sheet.id);

  const apply = async () => {
    if (!fitted) return;
    if (fitted.frames !== sheet.frames && uses.length > 0) {
      const ok = await confirmAction(
        `This sheet is used by ${uses.join(', ')}. Cut it into ${fitted.frames} frames per direction?`,
        { title: 'Change the frames', okLabel: 'Change frames' },
      );
      if (!ok) return;
    }
    doc.update(file.path, 'character', 'Change frame size', () => fitted);
  };

  return (
    <section>
      <h2>Image and frames</h2>
      <p className="hint">
        Character id <code>{sheet.id}</code>{' '}
        <RenameIdButton doc={doc} kind="character" id={sheet.id} what="character" />
      </p>
      <label className="field">
        <span>Image</span>
        <select
          value={sheet.image}
          onChange={(e) => {
            const path = e.target.value;
            doc.update(file.path, 'character', 'Change character image', (c) => ({
              ...c,
              image: path,
            }));
          }}
        >
          {[...new Set([sheet.image, ...images])].sort().map((p) => (
            <option key={p} value={p}>
              {p.replace(/^assets\//, '')}
            </option>
          ))}
        </select>
      </label>
      {image && (
        <p className="muted small">
          {image.width} × {image.height} px · {sheet.frames} frames per direction
        </p>
      )}
      <div className="row">
        <label className="field">
          <span>Frame width</span>
          <input
            type="number"
            min={1}
            value={Number.isFinite(width) ? width : ''}
            onChange={(e) => setWidth(e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          <span>Frame height</span>
          <input
            type="number"
            min={1}
            value={Number.isFinite(height) ? height : ''}
            onChange={(e) => setHeight(e.target.valueAsNumber)}
          />
        </label>
      </div>
      {(changed || (fitted && fitted !== sheet)) && (
        <button disabled={!fitted || (grid?.rows ?? 0) < 4} onClick={() => void apply()}>
          {grid && grid.rows < 4
            ? `Too tall: only ${grid.rows} rows fit`
            : `Cut into ${grid?.frames ?? '?'} frames per direction`}
        </button>
      )}
      <p className="hint">
        {uses.length > 0 ? `Used by ${uses.join(', ')}.` : 'Nothing uses this character yet.'}
      </p>
    </section>
  );
}
