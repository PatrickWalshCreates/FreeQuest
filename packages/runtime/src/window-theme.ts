// The look of every window (messages, menus, battle, shop, title, options) as the
// views draw it: a `UiTheme` made from the project's system `ui` (M17 step 1).
// PixiJS-free, so it's tested in Node.
import {
  DEFAULT_WINDOW_LOOK,
  type FullWindowLook,
  TEXT_COLORS,
  type TextColorName,
  WINDOW_FONT_FAMILY,
} from '@freequest/schema';

/** Look of the game's windows. Made from the project's look; `startGame({ ui })` can override it. */
export interface UiTheme {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  textColor: number;
  speakerColor: number;
  /** Changed while the game runs by `changeWindowColor` (the views read it as they draw). */
  windowColor: number;
  windowAlpha: number;
  borderColor: number;
  /** Gap between windows and the screen edge, in pixels. */
  margin: number;
  /** Space between a window's border and its contents, in pixels. */
  padding: number;
  /** Minimum text lines in the message box, so its size doesn't jump between messages. */
  minLines: number;
  /** What `{color:…}` names in messages look like. */
  textColors: Record<TextColorName, number>;
}

/** The system font, used when a project has no font of its own (or it can't be loaded). */
export const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** The font family that draws with the project's own font, falling back to the system font. */
export const WINDOW_FONT = `"${WINDOW_FONT_FAMILY}", ${SYSTEM_FONT}`;

/** #rrggbb as a number. */
export function colorNumber(hex: string): number {
  return parseInt(hex.slice(1), 16);
}

/** The theme a window look gives; `fontLoaded` says whether its own font is ready. */
export function themeFromLook(look: FullWindowLook, fontLoaded = false): UiTheme {
  return {
    fontFamily: look.font !== null && fontLoaded ? WINDOW_FONT : SYSTEM_FONT,
    fontSize: look.fontSize,
    lineHeight: look.lineHeight,
    textColor: colorNumber(look.textColor),
    speakerColor: colorNumber(look.speakerColor),
    windowColor: colorNumber(look.windowColor),
    windowAlpha: look.windowOpacity,
    borderColor: colorNumber(look.borderColor),
    margin: 8,
    padding: look.padding,
    minLines: 3,
    textColors: Object.fromEntries(
      TEXT_COLORS.map((c) => [c, colorNumber(look.textColors[c])]),
    ) as Record<TextColorName, number>,
  };
}

export const DEFAULT_UI_THEME: UiTheme = themeFromLook(DEFAULT_WINDOW_LOOK);

/** What loading a font needs from the browser (injectable for tests). */
export interface FontLoading {
  readonly fetchBytes: (url: string) => Promise<ArrayBuffer>;
  /** Registers the font's bytes under `family` and resolves once it can draw. */
  readonly register: (family: string, bytes: ArrayBuffer) => Promise<void>;
}

const browserFonts = (): FontLoading => ({
  fetchBytes: async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return response.arrayBuffer();
  },
  register: async (family, bytes) => {
    // From bytes rather than a url(): no font-src needed in any CSP.
    const face = new FontFace(family, bytes);
    await face.load();
    document.fonts.add(face);
  },
});

/**
 * Load the project's window font. True once it can draw; false (after a
 * warning) when the project has none or it can't be loaded, so the game uses
 * the system font instead of not starting.
 */
export async function loadWindowFont(
  look: FullWindowLook,
  assetUrl: (path: string) => Promise<string>,
  fonts: FontLoading = browserFonts(),
): Promise<boolean> {
  if (look.font === null) return false;
  try {
    const bytes = await fonts.fetchBytes(await assetUrl(look.font));
    await fonts.register(WINDOW_FONT_FAMILY, bytes);
    return true;
  } catch (error) {
    console.warn(`The window font ${look.font} couldn't be loaded; using the system font`, error);
    return false;
  }
}
