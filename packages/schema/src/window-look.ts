// The look of a game's windows (messages, menus, battle, shop, title): system.json
// `ui` (database v7). Every field is optional; `resolveWindowLook` fills in
// FreeQuest's own look, so the game and the editor's preview agree.
import Type, { type Static } from 'typebox';
import { RelativePath } from './common.js';
import { HexColor } from './command.js';
import { TEXT_COLORS, type TextColorName } from './text-codes.js';

/** Font files a project can use for its windows (under `assets/fonts/`). */
export const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const;

export const WindowLook = Type.Object(
  {
    /** A font file under assets/fonts (.ttf, .otf, .woff, .woff2); none = the system font. */
    font: Type.Optional(RelativePath),
    fontSize: Type.Optional(Type.Integer({ minimum: 6, maximum: 48 })),
    /**
     * Draw text at the screen's own resolution (smooth fonts read well) rather
     * than in the game's pixels, enlarged like the art (best for pixel fonts).
     */
    sharpText: Type.Optional(Type.Boolean()),
    /** Pixels from one line of text to the next. */
    lineHeight: Type.Optional(Type.Integer({ minimum: 6, maximum: 64 })),
    /** Space between a window's border and its contents, in pixels. */
    padding: Type.Optional(Type.Integer({ minimum: 0, maximum: 32 })),
    windowColor: Type.Optional(HexColor),
    /** 0 = see-through, 1 = solid. */
    windowOpacity: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    borderColor: Type.Optional(HexColor),
    textColor: Type.Optional(HexColor),
    /** Speakers' names, titles and the cursor. */
    speakerColor: Type.Optional(HexColor),
    /** What `{color:…}` names look like. */
    textColors: Type.Optional(
      Type.Partial(
        Type.Object(
          Object.fromEntries(TEXT_COLORS.map((c) => [c, HexColor])) as Record<
            TextColorName,
            typeof HexColor
          >,
          { additionalProperties: false },
        ),
        { additionalProperties: false },
      ),
    ),
  },
  {
    additionalProperties: false,
    description: 'How the game’s windows look (v7). Anything left out is FreeQuest’s own look.',
  },
);
export type WindowLook = Static<typeof WindowLook>;

/** A window look with every value filled in (a font of null = the system font). */
export interface FullWindowLook {
  readonly font: string | null;
  readonly fontSize: number;
  readonly sharpText: boolean;
  readonly lineHeight: number;
  readonly padding: number;
  readonly windowColor: string;
  readonly windowOpacity: number;
  readonly borderColor: string;
  readonly textColor: string;
  readonly speakerColor: string;
  readonly textColors: Readonly<Record<TextColorName, string>>;
}

/** FreeQuest's own look: what a project without `ui` (or a field of it) gets. */
export const DEFAULT_WINDOW_LOOK: FullWindowLook = {
  font: null,
  fontSize: 14,
  sharpText: false,
  lineHeight: 18,
  padding: 10,
  windowColor: '#141a2e',
  windowOpacity: 0.9,
  borderColor: '#e6dcc3',
  textColor: '#f4f1ea',
  speakerColor: '#ffd479',
  textColors: {
    white: '#ffffff',
    gray: '#a8a8b4',
    red: '#ff6b6b',
    orange: '#ffa94d',
    yellow: '#ffd479',
    green: '#8ce99a',
    blue: '#74c0fc',
    purple: '#d0a2ff',
  },
};

/** `look` with FreeQuest's own values for whatever it leaves out. */
export function resolveWindowLook(look: WindowLook | undefined): FullWindowLook {
  const d = DEFAULT_WINDOW_LOOK;
  if (!look) return d;
  const fontSize = look.fontSize ?? d.fontSize;
  return {
    font: look.font ?? null,
    fontSize,
    sharpText: look.sharpText ?? d.sharpText,
    // Without its own line height, a bigger font gets the same proportion of space.
    lineHeight:
      look.lineHeight ?? Math.max(fontSize, Math.round((fontSize * d.lineHeight) / d.fontSize)),
    padding: look.padding ?? d.padding,
    windowColor: look.windowColor ?? d.windowColor,
    windowOpacity: look.windowOpacity ?? d.windowOpacity,
    borderColor: look.borderColor ?? d.borderColor,
    textColor: look.textColor ?? d.textColor,
    speakerColor: look.speakerColor ?? d.speakerColor,
    textColors: { ...d.textColors, ...look.textColors },
  };
}

/** The CSS font family a game's own font is registered under (the game and the editor). */
export const WINDOW_FONT_FAMILY = 'FreeQuest window font';
