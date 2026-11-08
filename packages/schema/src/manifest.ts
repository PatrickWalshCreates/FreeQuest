import Type, { type Static } from 'typebox';
import { Direction, FileRef, Id, NonNegativeInt, PositiveInt } from './common.js';

export const MANIFEST_FORMAT_VERSION = 2;

/** Declares a switch or variable so it can be referenced by id and named in editors. */
export const FlagDeclaration = Type.Object(
  {
    id: Id,
    name: Type.String(),
  },
  { additionalProperties: false },
);
export type FlagDeclaration = Static<typeof FlagDeclaration>;

/** `project.json`: the entry point of every FreeQuest project. */
export const Manifest = Type.Object(
  {
    formatVersion: Type.Literal(MANIFEST_FORMAT_VERSION),
    name: Type.String({ minLength: 1 }),
    screen: Type.Object(
      {
        width: PositiveInt,
        height: PositiveInt,
      },
      { additionalProperties: false, description: 'Internal render resolution in pixels.' },
    ),
    start: Type.Object(
      {
        map: Id,
        x: NonNegativeInt,
        y: NonNegativeInt,
        direction: Direction,
      },
      { additionalProperties: false, description: 'Where the player appears on a new game.' },
    ),
    player: Type.Object(
      {
        character: Id,
        speed: Type.Number({
          exclusiveMinimum: 0,
          description: 'Walking speed in tiles per second.',
        }),
      },
      { additionalProperties: false },
    ),
    tilesets: Type.Array(FileRef),
    maps: Type.Array(FileRef),
    characters: Type.Array(FileRef),
    switches: Type.Array(FlagDeclaration, { description: 'Named on/off flags.' }),
    variables: Type.Array(FlagDeclaration, { description: 'Named integer values.' }),
  },
  { title: 'FreeQuest project manifest', additionalProperties: false },
);
export type Manifest = Static<typeof Manifest>;
