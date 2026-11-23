// The project's window look in the editor (M17 step 1): the theme the game
// would draw with, its font loaded for the page, and CSS for a window like the
// game's. Used by the Windows section's preview and the message preview.
import type { ProjectDocument } from '@freequest/editor-core';
import { SYSTEM_FONT, type UiTheme, themeFromLook } from '@freequest/runtime';
import { type FullWindowLook, type WindowLook, resolveWindowLook } from '@freequest/schema';
import type { CSSProperties } from 'react';
import { useLoaded } from '../map/graphics.js';

/** Each font file gets its own family name, so changing the font never shows the old one. */
const families = new Map<string, Promise<string>>();

function loadFont(url: string): Promise<string> {
  let family = families.get(url);
  if (!family) {
    const name = `FreeQuest preview ${families.size + 1}`;
    family = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.statusText))))
      .then(async (bytes) => {
        const face = new FontFace(name, bytes);
        await face.load();
        document.fonts.add(face);
        return name;
      });
    families.set(url, family);
  }
  return family;
}

export interface EditorWindowTheme {
  readonly look: FullWindowLook;
  readonly theme: UiTheme;
  /** CSS font-family to draw with (the project's font once loaded, else the system font). */
  readonly fontFamily: string;
  /** The look's font couldn't be loaded (the game would use the system font too). */
  readonly fontFailed: boolean;
}

/** The theme `look` gives (the project's own when omitted), with its font loaded for the page. */
export function useWindowTheme(doc: ProjectDocument, look?: WindowLook): EditorWindowTheme {
  const full = resolveWindowLook(look ?? doc.project.database.system?.data?.ui);
  const font = useLoaded(`${full.font ?? ''}:${doc.assets.version}`, async () =>
    full.font === null ? null : loadFont(await doc.fs.assetUrl(full.font)),
  );
  const loaded = font.status === 'ready' && font.value !== null;
  return {
    look: full,
    theme: themeFromLook(full, loaded),
    fontFamily: loaded ? `"${font.value}", ${SYSTEM_FONT}` : SYSTEM_FONT,
    fontFailed: full.font !== null && font.status === 'error',
  };
}

export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** CSS for a window as the game draws it, at `scale` screen pixels per game pixel. */
export function windowStyle(t: EditorWindowTheme, scale = 1): CSSProperties {
  const { theme } = t;
  const r = (theme.windowColor >> 16) & 255;
  const g = (theme.windowColor >> 8) & 255;
  const b = theme.windowColor & 255;
  return {
    background: `rgba(${r}, ${g}, ${b}, ${theme.windowAlpha})`,
    border: `${2 * scale}px solid ${hex(theme.borderColor)}`,
    borderRadius: 6 * scale,
    color: hex(theme.textColor),
    fontFamily: t.fontFamily,
    fontSize: theme.fontSize * scale,
    lineHeight: `${theme.lineHeight * scale}px`,
    padding: theme.padding * scale,
  };
}
