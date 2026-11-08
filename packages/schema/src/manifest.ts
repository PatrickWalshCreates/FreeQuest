import Type, { type Static } from 'typebox';
import { Direction, FileRef, Id, NonNegativeInt, PositiveInt, RelativePath } from './common.js';

export const MANIFEST_FORMAT_VERSION = 4;

/** Database categories, each stored in its own file. */
export const DATABASE_KINDS = [
  'system',
  'actors',
  'classes',
  'skills',
  'items',
  'equipment',
  'states',
  'enemies',
  'troops',
] as const;
export type DatabaseKind = (typeof DATABASE_KINDS)[number];

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
        party: Type.Array(Id, { description: 'Actor ids in the starting party, in order.' }),
        gold: NonNegativeInt,
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
    database: Type.Optional(
      Type.Partial(
        Type.Object(
          Object.fromEntries(DATABASE_KINDS.map((k) => [k, RelativePath])) as Record<
            DatabaseKind,
            typeof RelativePath
          >,
          { additionalProperties: false },
        ),
        {
          description: 'Path of each database file. A missing category is empty.',
          additionalProperties: false,
        },
      ),
    ),
  },
  { title: 'FreeQuest project manifest', additionalProperties: false },
);
export type Manifest = Static<typeof Manifest>;
