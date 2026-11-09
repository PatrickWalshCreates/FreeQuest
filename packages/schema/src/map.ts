import Type, { type Static } from 'typebox';
import { Id, PositiveInt, RelativePath } from './common.js';
import { MapEvent } from './event.js';

export const MAP_FORMAT_VERSION = 5;

/** Random battles while walking on a map. */
export const Encounters = Type.Object(
  {
    /** Average steps between battles. */
    steps: Type.Integer({ minimum: 1 }),
    troops: Type.Array(
      Type.Object(
        { troop: Id, weight: Type.Integer({ minimum: 1, description: 'Relative chance.' }) },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
  },
  { additionalProperties: false },
);
export type Encounters = Static<typeof Encounters>;

/** Tile index meaning "no tile in this cell". */
export const EMPTY_TILE = -1;

export const MapLayer = Type.Object(
  {
    name: Type.String(),
    data: Type.Array(Type.Array(Type.Integer({ minimum: EMPTY_TILE })), {
      description: 'Rows of tile indices, top to bottom. -1 means empty.',
    }),
  },
  { additionalProperties: false },
);
export type MapLayer = Static<typeof MapLayer>;

/**
 * A map is a stack of tile layers drawn bottom to top. Collision is not stored:
 * it is derived from the tileset's passability flags.
 */
export const GameMap = Type.Object(
  {
    formatVersion: Type.Literal(MAP_FORMAT_VERSION),
    id: Id,
    name: Type.String(),
    width: PositiveInt,
    height: PositiveInt,
    tileset: Id,
    layers: Type.Array(MapLayer, { minItems: 1 }),
    events: Type.Array(MapEvent),
    encounters: Type.Optional(Encounters),
    /** Background music while on this map (loops). Omit for silence. */
    music: Type.Optional(RelativePath),
  },
  { title: 'FreeQuest map', additionalProperties: false },
);
export type GameMap = Static<typeof GameMap>;
