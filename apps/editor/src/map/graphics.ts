// Textures for the map canvas, loaded through the project's ProjectFs so the
// same code works on the desktop (blob URLs) and the dev server.
import type { ProjectDocument } from '@freequest/editor-core';
import { type CharacterGraphic, loadPixelTexture, sliceGrid } from '@freequest/runtime';
import type { CharacterSheet, Tileset } from '@freequest/schema';
import type { Texture } from 'pixi.js';
import { useEffect, useState } from 'react';

const images = new WeakMap<ProjectDocument, Map<string, Promise<Texture>>>();

/** Load a project image as a crisp texture (the runtime's loader), once per document. */
export function loadImage(doc: ProjectDocument, path: string): Promise<Texture> {
  let cache = images.get(doc);
  if (!cache) {
    cache = new Map();
    images.set(doc, cache);
  }
  let texture = cache.get(path);
  if (!texture) {
    texture = loadPixelTexture(doc.fs.assetUrl(path));
    texture.catch(() => cache.delete(path));
    cache.set(path, texture);
  }
  return texture;
}

export async function loadTileTextures(doc: ProjectDocument, tileset: Tileset): Promise<Texture[]> {
  const image = await loadImage(doc, tileset.image);
  return sliceGrid(
    image,
    tileset.tileWidth,
    tileset.tileHeight,
    tileset.columns,
    tileset.tiles.length,
  );
}

export async function loadCharacter(
  doc: ProjectDocument,
  sheet: CharacterSheet,
): Promise<CharacterGraphic> {
  const image = await loadImage(doc, sheet.image);
  return {
    sheet,
    frames: sliceGrid(image, sheet.frameWidth, sheet.frameHeight, sheet.frames, sheet.frames * 4),
  };
}

export type Loaded<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly value: T }
  | { readonly status: 'error'; readonly message: string };

/** Run `load` whenever `key` changes; the latest result wins. */
export function useLoaded<T>(key: unknown, load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<{ key: unknown; loaded: Loaded<T> }>({
    key: undefined,
    loaded: { status: 'loading' },
  });
  useEffect(() => {
    let current = true;
    load().then(
      (value) => current && setState({ key, loaded: { status: 'ready', value } }),
      (error: unknown) =>
        current &&
        setState({
          key,
          loaded: {
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          },
        }),
    );
    return () => {
      current = false;
    };
    // `load` is a fresh closure every render; `key` says when it means something new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state.key === key ? state.loaded : { status: 'loading' };
}

const ids = new WeakMap<object, number>();
let nextId = 1;

/** A string that changes exactly when one of `objects` is a different object (for `useLoaded`). */
export function identityKey(objects: readonly object[]): string {
  return objects
    .map((object) => {
      let id = ids.get(object);
      if (id === undefined) {
        id = nextId++;
        ids.set(object, id);
      }
      return id;
    })
    .join(',');
}
