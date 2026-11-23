// M17 step 1: the project's window look as the views draw it, and its font.
import { DEFAULT_WINDOW_LOOK, WINDOW_FONT_FAMILY, resolveWindowLook } from '@freequest/schema';
import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UI_THEME,
  SYSTEM_FONT,
  WINDOW_FONT,
  loadWindowFont,
  themeFromLook,
} from '../src/window-theme.js';

describe('the window theme', () => {
  it('is FreeQuest’s own look without a project look', () => {
    expect(DEFAULT_UI_THEME).toMatchObject({
      fontFamily: SYSTEM_FONT,
      fontSize: 14,
      lineHeight: 18,
      windowColor: 0x141a2e,
      windowAlpha: 0.9,
      borderColor: 0xe6dcc3,
      padding: 10,
    });
    expect(DEFAULT_UI_THEME.textColors.red).toBe(0xff6b6b);
  });

  it('takes the project’s colours and sizes, and its font once it has loaded', () => {
    const look = resolveWindowLook({
      font: 'assets/fonts/pixel.ttf',
      fontSize: 8,
      windowColor: '#203040',
      windowOpacity: 1,
      textColors: { blue: '#0000ff' },
    });
    const theme = themeFromLook(look, true);
    expect(theme).toMatchObject({
      fontFamily: WINDOW_FONT,
      fontSize: 8,
      windowColor: 0x203040,
      windowAlpha: 1,
    });
    expect(theme.textColors.blue).toBe(0x0000ff);
    expect(WINDOW_FONT.startsWith(`"${WINDOW_FONT_FAMILY}"`)).toBe(true);
    // A font that didn't load: the system font, the rest as chosen.
    expect(themeFromLook(look, false).fontFamily).toBe(SYSTEM_FONT);
  });
});

describe('loading the window font', () => {
  const bytes = new ArrayBuffer(4);
  const asset = (path: string) => Promise.resolve(`blob:${path}`);

  it('registers the project’s font under FreeQuest’s family name', async () => {
    const register = vi.fn(() => Promise.resolve());
    const fetchBytes = vi.fn(() => Promise.resolve(bytes));
    const look = resolveWindowLook({ font: 'assets/fonts/pixel.ttf' });
    expect(await loadWindowFont(look, asset, { fetchBytes, register })).toBe(true);
    expect(fetchBytes).toHaveBeenCalledWith('blob:assets/fonts/pixel.ttf');
    expect(register).toHaveBeenCalledWith(WINDOW_FONT_FAMILY, bytes);
  });

  it('loads nothing without a font, and falls back after a warning when one fails', async () => {
    const register = vi.fn(() => Promise.reject(new Error('not a font')));
    const fetchBytes = vi.fn(() => Promise.resolve(bytes));
    expect(await loadWindowFont(DEFAULT_WINDOW_LOOK, asset, { fetchBytes, register })).toBe(false);
    expect(fetchBytes).not.toHaveBeenCalled();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const look = resolveWindowLook({ font: 'assets/fonts/broken.ttf' });
    expect(await loadWindowFont(look, asset, { fetchBytes, register })).toBe(false);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
