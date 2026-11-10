import { Rectangle, Texture } from 'pixi.js';

/**
 * Load an image as a texture with nearest-neighbour filtering (crisp pixel
 * art). Goes through an <img> rather than PixiJS `Assets`, which picks its
 * loader from the URL's extension and so can't load blob URLs (desktop
 * builds and the editor's playtest use those).
 */
export async function loadPixelTexture(url: string | Promise<string>): Promise<Texture> {
  const image = new Image();
  image.src = await url;
  try {
    await image.decode();
  } catch {
    throw new Error(`Could not load image ${image.src}`);
  }
  const texture = Texture.from(image);
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
