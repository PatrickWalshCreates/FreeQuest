import { EMPTY_TILE, type GameMap, type Tileset } from '@freequest/schema';
import { Container, Sprite, type Texture } from 'pixi.js';

/** Map tiles split into what is drawn under characters and what is drawn over them. */
export interface MapView {
  readonly below: Container;
  readonly above: Container;
}

export function createMapView(map: GameMap, tileset: Tileset, tiles: readonly Texture[]): MapView {
  const below = new Container({ label: 'map-below' });
  const above = new Container({ label: 'map-above' });
  const { tileWidth, tileHeight } = tileset;

  for (const layer of map.layers) {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const index = layer.data[y]?.[x] ?? EMPTY_TILE;
        if (index === EMPTY_TILE) continue;
        const texture = tiles[index];
        if (!texture) throw new Error(`map "${map.id}": tile ${index} has no image`);
        const sprite = new Sprite(texture);
        sprite.position.set(x * tileWidth, y * tileHeight);
        (tileset.tiles[index]?.above ? above : below).addChild(sprite);
      }
    }
  }
  return { below, above };
}
