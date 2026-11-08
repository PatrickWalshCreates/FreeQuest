import { Assets, Rectangle, Texture } from 'pixi.js';

/** Load an image as a texture with nearest-neighbour filtering (crisp pixel art). */
export async function loadPixelTexture(url: string): Promise<Texture> {
  const texture = await Assets.load<Texture>(url);
  texture.source.scaleMode = 'nearest';
  return texture;
}

/** Cut a texture into `count` cells of a grid, row by row. */
export function sliceGrid(
  texture: Texture,
  cellWidth: number,
  cellHeight: number,
  columns: number,
  count: number,
): Texture[] {
  const frames: Texture[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i % columns) * cellWidth;
    const y = Math.floor(i / columns) * cellHeight;
    if (x + cellWidth > texture.width || y + cellHeight > texture.height) {
      throw new Error(`cell ${i} lies outside the ${texture.width}x${texture.height} image`);
    }
    frames.push(
      new Texture({ source: texture.source, frame: new Rectangle(x, y, cellWidth, cellHeight) }),
    );
  }
  return frames;
}
