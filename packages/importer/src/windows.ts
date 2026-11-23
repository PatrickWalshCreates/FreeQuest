// The look of an MZ game's windows (M17 step 1): its window skin's background
// colour, shifted by the window tone, its main font and size. FreeQuest draws
// plain windows of one colour, so a skin's pattern and frame don't come across.
import { DEFAULT_WINDOW_LOOK, type WindowLook } from '@freequest/schema';
import type { GraphicsImporter } from './graphics.js';
import { asArray, asInt, asRecord, asString } from './json.js';
import type { ImportReport } from './report.js';

/** MZ's text size and line height when a project doesn't set its own. */
const MZ_FONT_SIZE = 26;
const MZ_LINE_HEIGHT = 36;
/** How solid MZ's window backs are (its back opacity, 192 of 255). */
const MZ_BACK_OPACITY = 192 / 255;

const clampByte = (v: number) => Math.min(255, Math.max(0, Math.round(v)));
const hexColor = (rgb: readonly number[]) =>
  `#${rgb.map((v) => clampByte(v).toString(16).padStart(2, '0')).join('')}`;

const DEFAULT_BACK = [1, 3, 5].map((i) =>
  parseInt(DEFAULT_WINDOW_LOOK.windowColor.slice(i, i + 2), 16),
) as [number, number, number];

export interface MzWindows {
  readonly ui: WindowLook;
  /**
   * The window colour a tone (MZ's Change window colour: −255…255 per
   * channel) gives; null when it's the project's own.
   */
  readonly colorFor: (tone: unknown) => string | null;
}

/** A tone as three numbers (MZ's fourth, grey, does nothing to windows). */
function readTone(tone: unknown): [number, number, number] {
  const t = asArray(tone);
  return [asInt(t[0]), asInt(t[1]), asInt(t[2])];
}

export async function importWindows(
  system: Readonly<Record<string, unknown>>,
  graphics: GraphicsImporter,
  report: ImportReport,
): Promise<MzWindows> {
  const back = (await graphics.windowBack()) ?? DEFAULT_BACK;
  const colorOf = (tone: unknown) => {
    const [r, g, b] = readTone(tone);
    return hexColor([back[0] + r, back[1] + g, back[2] + b]);
  };
  const windowColor = colorOf(system['windowTone']);
  const advanced = asRecord(system['advanced']);
  const fontSize = Math.min(48, Math.max(6, asInt(advanced['fontSize'], MZ_FONT_SIZE)));
  const fontFile = asString(advanced['mainFontFilename']).trim();
  const font = fontFile ? await graphics.font(fontFile, 'System') : null;
  report.changed(
    'System',
    'Windows are one colour with a plain border: the window skin’s colour is used, its pattern and frame aren’t.',
    [{ name: 'Window skin', count: 1 }],
  );
  return {
    ui: {
      ...(font ? { font } : {}),
      fontSize,
      lineHeight: Math.max(fontSize, Math.round((fontSize * MZ_LINE_HEIGHT) / MZ_FONT_SIZE)),
      padding: 12,
      windowColor,
      windowOpacity: Math.round(MZ_BACK_OPACITY * 100) / 100,
    },
    colorFor: (tone) => {
      const color = colorOf(tone);
      return color === windowColor ? null : color;
    },
  };
}
