// The game's iconset (system.json `iconset`): one image of square icons in
// a grid, sliced once at start. Lists draw an option's icon before its label.
import type { SystemData } from '@freequest/schema';
import { Sprite, type Texture } from 'pixi.js';
import { loadPixelTexture, sliceGrid } from './textures.js';

export interface IconSheet {
  /** Pixel size of one icon (0 when there are none). */
  readonly size: number;
  /** The icon at `index`, or null if the sheet doesn't have it. */
  texture(index: number): Texture | null;
}

/** For games without an iconset: lists look as they did before icons. */
export const NO_ICONS: IconSheet = { size: 0, texture: () => null };

/** Load and slice the iconset. A missing or broken image gives NO_ICONS (after a warning). */
export async function loadIconSheet(
  iconset: SystemData['iconset'],
  assetUrl: (path: string) => Promise<string>,
): Promise<IconSheet> {
  if (!iconset) return NO_ICONS;
  try {
    const image = await loadPixelTexture(assetUrl(iconset.image));
    const size = iconset.iconSize;
    const rows = Math.floor(image.height / size);
    const columns = Math.min(iconset.columns, Math.floor(image.width / size));
    const textures = sliceGrid(image, size, size, columns, columns * rows);
    // Indexes count across the declared columns, even if the image is narrower.
    return {
      size,
      texture: (index) => {
        const column = index % iconset.columns;
        const row = Math.floor(index / iconset.columns);
        return column < columns ? (textures[row * columns + column] ?? null) : null;
      },
    };
  } catch (error) {
    console.warn(`Icons not shown: could not load ${iconset.image}`, error);
    return NO_ICONS;
  }
}

/** A sprite for an icon, shrunk to fit a row `height` pixels tall if it's bigger. */
export function iconSprite(icons: IconSheet, index: number, height: number): Sprite | null {
  const texture = icons.texture(index);
  if (!texture) return null;
  const sprite = new Sprite(texture);
  const scale = icons.size > height ? height / icons.size : 1;
  sprite.scale.set(scale);
  return sprite;
}

/** `{ icon }` when there is one, so option objects stay free of `icon: undefined`. */
export function withIcon(icon: number | undefined): { icon?: number } {
  return icon === undefined ? {} : { icon };
}
