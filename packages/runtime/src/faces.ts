// Faces beside messages: each face sheet is one row of square faces, as tall
// as the image (schema's `faceSheetLayout`). Sheets load on first use (or
// earlier, from `preload` when a map appears) and are sliced once; until one
// has loaded, its messages show without the face.
import { type MessageFace, faceSheetLayout } from '@freequest/schema';
import type { Texture } from 'pixi.js';
import { loadPixelTexture, sliceGrid } from './textures.js';

export interface FaceSheets {
  /** The face's picture, or null while its sheet loads (or if it can't be shown). */
  face(face: MessageFace): Texture | null;
  /** Start loading these sheets now, so their first message has its face at once. */
  preload(images: Iterable<string>): void;
}

/** For games or tests without faces. */
export const NO_FACES: FaceSheets = { face: () => null, preload: () => undefined };

export function createFaceSheets(
  assetUrl: (path: string) => Promise<string>,
  load: (url: Promise<string>) => Promise<Texture> = loadPixelTexture,
): FaceSheets {
  /** Loaded sheets' faces; null for a sheet that failed (warned once). */
  const sheets = new Map<string, Texture[] | null>();
  const loading = new Set<string>();
  const warned = new Set<string>();

  const start = (image: string) => {
    if (sheets.has(image) || loading.has(image)) return;
    loading.add(image);
    load(assetUrl(image))
      .then((texture) => {
        const { size, count } = faceSheetLayout(texture.width, texture.height);
        sheets.set(image, count > 0 ? sliceGrid(texture, size, size, count, count) : []);
      })
      .catch((error: unknown) => {
        console.warn(`Faces not shown: could not load ${image}`, error);
        sheets.set(image, null);
      })
      .finally(() => loading.delete(image));
  };

  return {
    face(face) {
      const sheet = sheets.get(face.image);
      if (sheet === undefined) {
        start(face.image);
        return null;
      }
      const texture = sheet?.[face.index] ?? null;
      const key = `${face.image}#${face.index}`;
      if (sheet && !texture && !warned.has(key)) {
        warned.add(key);
        console.warn(`${face.image} has no face ${face.index} (it holds ${sheet.length})`);
      }
      return texture;
    },
    preload(images) {
      for (const image of images) start(image);
    },
  };
}
