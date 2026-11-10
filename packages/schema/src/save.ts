import Type, { type Static } from 'typebox';
import { Direction, Id, NonNegativeInt, PositiveInt } from './common.js';

export const SAVE_FORMAT_VERSION = 1;

const Counts = Type.Record(Type.String(), NonNegativeInt);

const SavedState = Type.Object(
  {
    id: Id,
    turns: Type.Optional(NonNegativeInt),
    steps: Type.Optional(NonNegativeInt),
  },
  { additionalProperties: false },
);

const SavedActor = Type.Object(
  {
    id: Id,
    level: PositiveInt,
    exp: NonNegativeInt,
    hp: NonNegativeInt,
    mp: NonNegativeInt,
    equipment: Type.Record(Type.String(), Id),
    extraSkills: Type.Array(Id),
    states: Type.Array(SavedState),
  },
  { additionalProperties: false },
);

/**
 * A saved game. Saving happens only from the menu, when no event is
 * running, so there is never interpreter state to store.
 */
export const SaveFile = Type.Object(
  {
    formatVersion: Type.Literal(SAVE_FORMAT_VERSION),
    /** The game's id (older saves: its name), to catch loading a save into the wrong game. */
    game: Type.String(),
    /** ISO 8601 timestamp. */
    savedAt: Type.String(),
    playSeconds: Type.Number({ minimum: 0 }),
    map: Id,
    x: NonNegativeInt,
    y: NonNegativeInt,
    direction: Direction,
    switches: Type.Record(Type.String(), Type.Boolean()),
    variables: Type.Record(Type.String(), Type.Integer()),
    party: Type.Object(
      {
        members: Type.Array(SavedActor),
        gold: NonNegativeInt,
        items: Counts,
        equipment: Counts,
        steps: NonNegativeInt,
      },
      { additionalProperties: false },
    ),
    /** What a save slot list shows, readable without loading the game. */
    summary: Type.Object(
      {
        location: Type.String(),
        members: Type.Array(
          Type.Object({ name: Type.String(), level: PositiveInt }, { additionalProperties: false }),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { title: 'FreeQuest save file', additionalProperties: false },
);
export type SaveFile = Static<typeof SaveFile>;
