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
      'parallel: runs alongside play.',
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
