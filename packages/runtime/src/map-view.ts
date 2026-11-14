import { chunkKey, chunkTiles, chunksInView, inRange } from '@freequest/core';
import { EMPTY_TILE, type GameMap, type Tileset } from '@freequest/schema';
import { Container, Sprite, type Texture } from 'pixi.js';

/**
 * Map tiles split into what is drawn under characters and what is drawn
 * over them, built in chunks (core's `chunks.ts`) only near the camera:
 * call `update` with the view each frame. A chunk that leaves the view (with
 * a margin) is freed, so a big map costs what the screen shows.
 */
export interface MapView {
  readonly below: Container;
  readonly above: Container;
  /** Build the chunks around `view` (map pixels) and free the ones far from it. */
  update(view: { x: number; y: number; width: number; height: number }): void;
  /** Chunks built right now (for tests and the debug panel). */
  readonly builtChunks: number;
}

/** Chunks this many past the view are kept; beyond that they're freed. */
const KEEP_MARGIN = 2;

export function createMapView(map: GameMap, tileset: Tileset, tiles: readonly Texture[]): MapView {
  const below = new Container({ label: 'map-below' });
  const above = new Container({ label: 'map-above' });
  const { tileWidth, tileHeight } = tileset;
  // Every tile must have an image: check once, as before, rather than when a chunk appears.
  for (const layer of map.layers) {
    for (const row of layer.data) {
      for (const index of row) {
        if (index !== EMPTY_TILE && !tiles[index]) {
          throw new Error(`map "${map.id}": tile ${index} has no image`);
        }
      }
    }
  }
  const built = new Map<string, { below: Container; above: Container }>();

  const build = (cx: number, cy: number) => {
    const chunk = {
      below: new Container({ label: `chunk ${cx},${cy}` }),
      above: new Container({ label: `chunk ${cx},${cy}` }),
    };
    const area = chunkTiles(cx, cy, map.width, map.height);
    for (const layer of map.layers) {
      for (let y = area.y0; y <= area.y1; y++) {
        const row = layer.data[y];
        for (let x = area.x0; x <= area.x1; x++) {
          const index = row?.[x] ?? EMPTY_TILE;
          const texture = index === EMPTY_TILE ? undefined : tiles[index];
          if (!texture) continue;
          const sprite = new Sprite(texture);
          sprite.position.set(x * tileWidth, y * tileHeight);
          (tileset.tiles[index]?.above ? chunk.above : chunk.below).addChild(sprite);
        }
      }
    }
    below.addChild(chunk.below);
    above.addChild(chunk.above);
    built.set(chunkKey(cx, cy), chunk);
  };

  return {
    below,
    above,
    get builtChunks() {
      return built.size;
    },
    update(view) {
      const wanted = chunksInView(view, tileWidth, tileHeight, map.width, map.height, 1);
      const kept = chunksInView(view, tileWidth, tileHeight, map.width, map.height, KEEP_MARGIN);
      for (const [key, chunk] of built) {
        const [cx = 0, cy = 0] = key.split(',').map(Number);
        if (inRange(kept, cx, cy)) continue;
        chunk.below.destroy({ children: true });
        chunk.above.destroy({ children: true });
        built.delete(key);
      }
      if (!wanted) return;
      for (let cy = wanted.y0; cy <= wanted.y1; cy++) {
        for (let cx = wanted.x0; cx <= wanted.x1; cx++) {
          if (!built.has(chunkKey(cx, cy))) build(cx, cy);
        }
      }
    },
  };
}
