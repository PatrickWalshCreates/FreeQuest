import Type, { type Static } from 'typebox';
import { Direction, Id, NonNegativeInt } from './common.js';
import { Command } from './command.js';
import { Condition } from './condition.js';

export const EventTrigger = Type.Union(
  [
    Type.Literal('action'),
    Type.Literal('touch'),
    Type.Literal('autorun'),
    Type.Literal('parallel'),
  ],
  {
    description:
      'action: player faces it and presses confirm. touch: player steps into or onto it. ' +
      'autorun: runs as soon as the page is active, blocking the player. ' +
      'parallel: runs alongside play, over and over; messages, choices, battles and ' +
      'transfers wait until nothing else runs.',
  },
);
export type EventTrigger = Static<typeof EventTrigger>;

export const EventLayer = Type.Union(
  [Type.Literal('below'), Type.Literal('same'), Type.Literal('above')],
  {
    description: 'Drawn below, level with, or above characters. Only "same" blocks movement.',
  },
);
export type EventLayer = Static<typeof EventLayer>;

/**
 * How an event moves on its own while its page is active. Leave it out for an
 * event that stays put. Moving events walk tile by tile like the player and
 * never walk through the player, blocking events or impassable tiles.
 */
export const EventMovement = Type.Object(
  {
    type: Type.Union([Type.Literal('random'), Type.Literal('approach')], {
      description: 'random: wanders about. approach: walks toward the player.',
    }),
    speed: Type.Number({
      exclusiveMinimum: 0,
      maximum: 16,
      description: 'Walking speed in tiles per second (the player usually walks at 4).',
    }),
    pause: Type.Number({
      minimum: 0,
      maximum: 60,
      description: 'Seconds to stand still between steps (random movement varies it a little).',
    }),
  },
  { additionalProperties: false },
);
export type EventMovement = Static<typeof EventMovement>;

/**
 * One state of an event. The active page is the last one whose conditions
 * all hold; if none holds, the event is absent from the map.
 */
export const EventPage = Type.Object(
  {
    conditions: Type.Array(Condition),
    graphic: Type.Optional(
      Type.Object(
        { character: Id, direction: Direction },
        { additionalProperties: false, description: 'Omit for an invisible event.' },
      ),
    ),
    trigger: EventTrigger,
    layer: EventLayer,
    movement: Type.Optional(EventMovement),
    commands: Type.Array(Command),
  },
  { additionalProperties: false },
);
export type EventPage = Static<typeof EventPage>;

/** Something on a map that can be interacted with: an NPC, a sign, a door. */
export const MapEvent = Type.Object(
  {
    id: Id,
    name: Type.String(),
    x: NonNegativeInt,
    y: NonNegativeInt,
    pages: Type.Array(EventPage, { minItems: 1 }),
  },
  { additionalProperties: false },
);
export type MapEvent = Static<typeof MapEvent>;
