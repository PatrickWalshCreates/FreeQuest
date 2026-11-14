import Type, { type Static } from 'typebox';
import {
  Direction,
  FileRef,
  ID_PATTERN,
  Id,
  NonNegativeInt,
  PositiveInt,
  RelativePath,
} from './common.js';

export const MANIFEST_FORMAT_VERSION = 7;

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
  'commonEvents',
] as const;
export type DatabaseKind = (typeof DATABASE_KINDS)[number];

/**
 * Kinds of id that save files store, so renaming one is recorded in the
 * manifest's `renames` and translated when an older save loads.
 */
export const SAVE_RENAME_KINDS = [
  'map',
  'switch',
  'variable',
  'actor',
  'item',
  'equipment',
  'skill',
  'state',
  'equipmentSlot',
  'event',
] as const;
export type SaveRenameKind = (typeof SAVE_RENAME_KINDS)[number];

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
    id: Type.String({
      pattern: ID_PATTERN,
      description:
        'Permanent id of the game. Keeps its saves and desktop app data apart from other games; ' +
        'changing it after release makes players lose their saves.',
    }),
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
    renames: Type.Optional(
      Type.Partial(
        Type.Object(
          Object.fromEntries(
            SAVE_RENAME_KINDS.map((k) => [k, Type.Record(Type.String(), Type.String())]),
          ) as Record<
            SaveRenameKind,
            ReturnType<
              typeof Type.Record<ReturnType<typeof Type.String>, ReturnType<typeof Type.String>>
            >
          >,
          { additionalProperties: false },
        ),
        {
          description:
            'Ids renamed in the editor, old → new per kind (events "map/event"), so saves made before still load (v7).',
          additionalProperties: false,
        },
      ),
    ),
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
