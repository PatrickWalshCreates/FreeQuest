// Database › System › Windows (M17 step 1): the look of every window in the game
// (font, sizes, colours), with a preview of a message and a menu drawn the way
// the game draws them. Anything left at FreeQuest's own look stays out of the file.
import type { ProjectDocument } from '@freequest/editor-core';
import { textColor } from '@freequest/runtime';
import {
  DEFAULT_WINDOW_LOOK,
  TEXT_COLORS,
  type TextColorName,
  type WindowLook,
} from '@freequest/schema';
import { ColorField } from '../forms/ColorField.js';
import { hex, useWindowTheme, windowStyle } from '../forms/window-theme.js';

export const FONT_FILE = /\.(ttf|otf|woff2?)$/i;

type ColorKey = 'windowColor' | 'borderColor' | 'textColor' | 'speakerColor';
type SizeKey = 'fontSize' | 'lineHeight' | 'padding';

const COLORS: readonly { key: ColorKey; label: string }[] = [
  { key: 'windowColor', label: 'Window' },
  { key: 'borderColor', label: 'Border' },
  { key: 'textColor', label: 'Text' },
  { key: 'speakerColor', label: 'Names, titles and the cursor' },
];

const SIZES: readonly { key: SizeKey; label: string; min: number; max: number }[] = [
  { key: 'fontSize', label: 'Text size', min: 6, max: 48 },
  { key: 'lineHeight', label: 'Line height', min: 6, max: 64 },
  { key: 'padding', label: 'Space inside windows', min: 0, max: 32 },
];

/** `look` with `key` set (undefined = FreeQuest's own); an empty look is no look at all. */
function withField<K extends keyof WindowLook>(
  look: WindowLook | undefined,
  key: K,
  value: WindowLook[K] | undefined,
): WindowLook | undefined {
  const next = Object.fromEntries(Object.entries(look ?? {}).filter(([k]) => k !== key));
  if (value !== undefined) next[key] = value;
  return Object.keys(next).length === 0 ? undefined : (next as WindowLook);
}

export function WindowLookField(props: {
  readonly doc: ProjectDocument;
  readonly fonts: readonly string[];
  readonly value: WindowLook | undefined;
  readonly onChange: (value: WindowLook | undefined) => void;
}) {
  const { doc, fonts, value, onChange } = props;
  const look = useWindowTheme(doc, value ?? {});
  const full = look.look;
  const set = <K extends keyof WindowLook>(key: K, v: WindowLook[K] | undefined) =>
    onChange(withField(value, key, v));
  const setTextColor = (name: TextColorName, color: string) => {
    const colors: Record<string, string> = Object.fromEntries(
      Object.entries(value?.textColors ?? {}).filter(([k]) => k !== name),
    );
    if (color !== DEFAULT_WINDOW_LOOK.textColors[name]) colors[name] = color;
    set('textColors', Object.keys(colors).length === 0 ? undefined : colors);
  };
  const fontOptions = [...new Set([...fonts, ...(value?.font ? [value.font] : [])])].sort();

  return (
    <div className="window-look">
      <div className="window-look-fields">
        <label className="field">
          <span>Font</span>
          <select
            value={value?.font ?? ''}
            onChange={(e) => set('font', e.target.value || undefined)}
          >
            <option value="">The system font</option>
            {fontOptions.map((p) => (
              <option key={p} value={p}>
                {p.replace(/^assets\//, '')}
                {fonts.includes(p) ? '' : ' (missing)'}
              </option>
            ))}
          </select>
        </label>
        {fonts.length === 0 && !value?.font && (
          <p className="hint">
            To use a font of your own, import a .ttf, .otf, .woff or .woff2 file in Assets (Fonts).
            Check its licence allows putting it in a game.
          </p>
        )}
        {look.fontFailed && (
          <p className="error">This font couldn’t be loaded; the game would use the system font.</p>
        )}
        <label className="toggle">
          <input
            type="checkbox"
            checked={full.sharpText}
            onChange={(e) => set('sharpText', e.target.checked ? true : undefined)}
          />
          Sharp text
        </label>
        <p className="hint">
          {full.sharpText
            ? 'Text is drawn at the screen’s own resolution, so smooth fonts read well at any size. The art stays pixel-crisp.'
            : 'Text is drawn in the game’s pixels and enlarged with the art, like a pixel font. Turn on sharp text for smooth fonts. (The preview shows text sharp either way.)'}
        </p>
        {SIZES.map(({ key, label, min, max }) => (
          <label key={key} className="field">
            <span>{label}</span>
            <input
              type="number"
              min={min}
              max={max}
              value={value?.[key] ?? ''}
              placeholder={String(full[key])}
              onChange={(e) => {
                const n = e.target.valueAsNumber;
                set(
                  key,
                  Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : undefined,
                );
              }}
            />
          </label>
        ))}
        {COLORS.map(({ key, label }) => (
          <div key={key} className="field">
            <span>{label}</span>
            <ColorField value={full[key]} onChange={(c) => set(key, c ?? undefined)} />
            {value?.[key] !== undefined && (
              <button className="small" onClick={() => set(key, undefined)}>
                FreeQuest’s
              </button>
            )}
          </div>
        ))}
        <label className="field">
          <span>Window opacity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={full.windowOpacity}
            onChange={(e) => set('windowOpacity', e.target.valueAsNumber)}
          />
          <code>{Math.round(full.windowOpacity * 100)}%</code>
        </label>
        <details>
          <summary>Colours for {'{color:…}'} in messages</summary>
          <div className="window-look-text-colors">
            {TEXT_COLORS.map((name) => (
              <div key={name} className="field">
                <span>{name}</span>
                <ColorField
                  value={full.textColors[name]}
                  onChange={(c) => c && setTextColor(name, c)}
                />
              </div>
            ))}
          </div>
        </details>
        {value !== undefined && (
          <button className="small" onClick={() => onChange(undefined)}>
            Back to FreeQuest’s look
          </button>
        )}
      </div>
      <Preview doc={doc} look={look} />
    </div>
  );
}

/** A message and a menu at twice the game's size, over a bit of grass. */
function Preview(props: {
  readonly doc: ProjectDocument;
  readonly look: ReturnType<typeof useWindowTheme>;
}) {
  const { look } = props;
  const { theme } = look;
  const scale = 2;
  const style = windowStyle(look, scale);
  const currency = props.doc.project.database.system?.data?.currency ?? 'G';
  const row = (label: string, detail: string, picked: boolean) => (
    <div
      className="window-look-row"
      style={{
        height: theme.lineHeight * scale,
        background: picked ? `${hex(theme.borderColor)}38` : undefined,
      }}
    >
      <span style={{ color: picked ? hex(theme.speakerColor) : 'transparent' }}>▸</span>
      <span>{label}</span>
      <span className="window-look-detail" style={{ fontSize: (theme.fontSize - 2) * scale }}>
        {detail}
      </span>
    </div>
  );
  return (
    <div className="window-look-preview" aria-label="Preview">
      <div className="window-look-menu" style={style}>
        <div style={{ color: hex(theme.speakerColor) }}>Items</div>
        {row('Potion', '×3', true)}
        {row('Ether', '×1', false)}
      </div>
      <div className="window-look-message" style={style}>
        <div style={{ color: hex(theme.speakerColor), fontWeight: 'bold' }}>Elder</div>
        <div>
          The bridge is out. Bring me{' '}
          <span style={{ color: hex(textColor(theme, 'yellow')) }}>three planks</span> and{' '}
          <span style={{ color: hex(textColor(theme, 'green')) }}>50 {currency}</span>.
        </div>
      </div>
    </div>
  );
}
