import Type, { type Static } from 'typebox';
import { Direction, Id, NonNegativeInt, PositiveInt } from './common.js';

export const SAVE_FORMAT_VERSION = 4;

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
 * A saved game. Saving happens from the menu, when no event is running, or
 * from an event's Open save screen, saved as if that event had finished; so
 * there is never interpreter state to store.
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
    /** The screen's tint and fade, as events left them (v2). */
    screen: Type.Optional(
      Type.Object(
        {
          fade: Type.Number({ minimum: 0, maximum: 1 }),
          tint: Type.Object(
            {
              color: Type.String({ pattern: '^#[0-9a-fA-F]{6}$' }),
              strength: Type.Number({ minimum: 0, maximum: 1 }),
            },
            { additionalProperties: false },
          ),
        },
        { additionalProperties: false },
      ),
    ),
    /** Event flags that are on: map id → event id → flag ids (v2). */
    flags: Type.Record(Type.String(), Type.Record(Type.String(), Type.Array(Id))),
    /** The player hidden by an event (v3). */
    playerHidden: Type.Optional(Type.Boolean()),
    /** The menu or saving turned off by an event (v3). */
    access: Type.Optional(
      Type.Object(
        { menu: Type.Optional(Type.Boolean()), saving: Type.Optional(Type.Boolean()) },
        { additionalProperties: false },
      ),
    ),
    /** Pictures shown by events, as they are now (v3). */
    pictures: Type.Optional(
      Type.Array(
        Type.Object(
          {
            number: Type.Integer({ minimum: 1 }),
            image: Type.String(),
            origin: Type.Union([Type.Literal('top-left'), Type.Literal('center')]),
            x: Type.Number(),
            y: Type.Number(),
            scaleX: Type.Number({ minimum: 0 }),
            scaleY: Type.Number({ minimum: 0 }),
            opacity: Type.Number({ minimum: 0, maximum: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    /**
     * Each plugin's own data, by plugin id: plain JSON it stored with
     * `game.setData` (v4). Kept even for plugins the project no longer has.
     */
    plugins: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    /** Battle and victory music changed by events; null = none (v3). */
    battleMusic: Type.Optional(
      Type.Object(
        {
          battle: Type.Optional(Type.Union([Type.String(), Type.Null()])),
          victory: Type.Optional(Type.Union([Type.String(), Type.Null()])),
        },
        { additionalProperties: false },
      ),
    ),
    party: Type.Object(
      {
        /** Actors' changed names and characters, members or not (v3). */
        looks: Type.Optional(
          Type.Record(
            Type.String(),
            Type.Object(
              { name: Type.Optional(Type.String()), character: Type.Optional(Id) },
              { additionalProperties: false },
            ),
          ),
        ),
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
