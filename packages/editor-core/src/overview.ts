// The editor's zoomed-out view of a map: one pixel per cell, coloured with
// each tile's average colour and blended through the visible layers. Far out
// a tile is a few screen pixels anyway, and this is one small image instead
// of a sprite per cell, cheap to redraw after every edit. Pure pixel math;
// the renderer turns it into a texture.
import { EMPTY_TILE, type GameMap } from '@freequest/schema';

/** A colour with alpha, each 0–255. */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

/**
 * Each tile's average colour, from the tileset image's pixels (RGBA, row by
 * row). Colours are weighted by alpha, so a tree on a transparent background
 * averages to green, half see-through.
 */
export function averageTileColors(
  pixels: Uint8ClampedArray | Uint8Array,
  imageWidth: number,
  tileWidth: number,
  tileHeight: number,
  columns: number,
  count: number,
): Rgba[] {
  const colors: Rgba[] = [];
  for (let i = 0; i < count; i++) {
    const ox = (i % columns) * tileWidth;
    const oy = Math.floor(i / columns) * tileHeight;
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let y = oy; y < oy + tileHeight; y++) {
      for (let x = ox; x < ox + tileWidth; x++) {
        const p = (y * imageWidth + x) * 4;
        const alpha = pixels[p + 3] ?? 0;
        r += (pixels[p] ?? 0) * alpha;
        g += (pixels[p + 1] ?? 0) * alpha;
        b += (pixels[p + 2] ?? 0) * alpha;
        a += alpha;
      }
    }
    const area = tileWidth * tileHeight;
    colors.push(
      a === 0
        ? { r: 0, g: 0, b: 0, a: 0 }
        : { r: r / a, g: g / a, b: b / a, a: Math.round(a / area) },
    );
  }
  return colors;
}

export interface OverviewOptions {
  /** Layers not shown. */
  readonly hiddenLayers?: ReadonlySet<number>;
  /** Layers drawn faded (the editor's "highlight layer"): index → opacity 0–1. */
  readonly layerOpacity?: (layer: number) => number;
  /** What empty cells show. */
  readonly floor: Rgba;
}

/** The map as RGBA pixels, one per cell (width × height × 4). */
export function overviewPixels(
  map: GameMap,
  colors: readonly Rgba[],
  options: OverviewOptions,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(map.width * map.height * 4);
  const { floor } = options;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      let r = floor.r;
      let g = floor.g;
      let b = floor.b;
      map.layers.forEach((layer, l) => {
        if (options.hiddenLayers?.has(l)) return;
        const index = layer.data[y]?.[x] ?? EMPTY_TILE;
        const c = index === EMPTY_TILE ? undefined : colors[index];
        if (!c || c.a === 0) return;
        const t = (c.a / 255) * (options.layerOpacity?.(l) ?? 1);
        r += (c.r - r) * t;
        g += (c.g - g) * t;
        b += (c.b - b) * t;
      });
      const p = (y * map.width + x) * 4;
      out[p] = r;
      out[p + 1] = g;
      out[p + 2] = b;
      out[p + 3] = 255;
    }
  }
  return out;
}
