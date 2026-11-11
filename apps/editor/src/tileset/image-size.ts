import type { ProjectDocument } from '@freequest/editor-core';
import { useLoaded } from '../map/graphics.js';

export interface ImageInfo {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** Load a project image's URL and natural size (any format the browser reads). */
export function useImage(doc: ProjectDocument, path: string | null) {
  return useLoaded(`${path ?? ''}:${doc.assets.version}`, async (): Promise<ImageInfo | null> => {
    if (!path) return null;
    const url = await doc.fs.assetUrl(path);
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error(`${path} is missing or isn't an image the editor can read`);
    });
    return { url, width: image.naturalWidth, height: image.naturalHeight };
  });
}
