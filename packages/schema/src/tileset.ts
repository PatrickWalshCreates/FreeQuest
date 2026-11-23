import Type, { type Static } from 'typebox';
import { Direction, Id, PositiveInt, RelativePath } from './common.js';

export const TILESET_FORMAT_VERSION = 2;

export const Tile = Type.Object(
  {
    name: Type.Optional(Type.String()),
    passable: Type.Boolean({ description: 'Whether characters can walk onto this tile.' }),
    /**
     * Sides of a walkable tile that can't be crossed, entering or leaving
     * (v2): a fence along one edge, a cliff's rim, the top of a wall you walk
     * along. Jumps go over them.
     */
    blocks: Type.Optional(Type.Array(Direction, { minItems: 1, maxItems: 4, uniqueItems: true })),
    above: Type.Optional(
      Type.Boolean({
        description: 'Drawn above characters and ignored for collision (e.g. treetops).',
      }),
    ),
  },
  { additionalProperties: false },
);
export type Tile = Static<typeof Tile>;

/**
 * A tileset is an image cut into a grid. Tile index `i` is the cell at column
 * `i % columns`, row `floor(i / columns)`; `tiles[i]` holds its flags.
 */
export const Tileset = Type.Object(
  {
    formatVersion: Type.Literal(TILESET_FORMAT_VERSION),
    id: Id,
    name: Type.String(),
    image: RelativePath,
    tileWidth: PositiveInt,
    tileHeight: PositiveInt,
    columns: PositiveInt,
    tiles: Type.Array(Tile, { minItems: 1 }),
  },
  { title: 'FreeQuest tileset', additionalProperties: false },
);
export type Tileset = Static<typeof Tileset>;
