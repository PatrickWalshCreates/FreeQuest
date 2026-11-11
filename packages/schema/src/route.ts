import Type, { type Static } from 'typebox';

/** Which way a route step goes: a fixed direction, or one worked out when the step runs. */
export const RouteDirection = Type.Union(
  [
    Type.Literal('down'),
    Type.Literal('left'),
    Type.Literal('right'),
    Type.Literal('up'),
    Type.Literal('forward'),
    Type.Literal('random'),
    Type.Literal('toward-player'),
    Type.Literal('away-from-player'),
  ],
  {
    description:
      'forward: the way the character faces; the player ones are worked out at the time.',
  },
);
export type RouteDirection = Static<typeof RouteDirection>;

/** Which way a turn step faces. "around" turns to the opposite direction. */
export const TurnDirection = Type.Union([
  Type.Literal('down'),
  Type.Literal('left'),
  Type.Literal('right'),
  Type.Literal('up'),
  Type.Literal('around'),
  Type.Literal('random'),
  Type.Literal('toward-player'),
  Type.Literal('away-from-player'),
]);
export type TurnDirection = Static<typeof TurnDirection>;

/** One step of a move route. */
export const MoveStep = Type.Union([
  Type.Object(
    { type: Type.Literal('move'), direction: RouteDirection },
    { additionalProperties: false, description: 'Walk one tile.' },
  ),
  Type.Object(
    { type: Type.Literal('turn'), direction: TurnDirection },
    { additionalProperties: false, description: 'Face a direction without moving.' },
  ),
  Type.Object(
    { type: Type.Literal('wait'), seconds: Type.Number({ minimum: 0, maximum: 60 }) },
    { additionalProperties: false, description: 'Stand still.' },
  ),
  Type.Object(
    {
      type: Type.Literal('speed'),
      speed: Type.Number({ exclusiveMinimum: 0, maximum: 16, description: 'Tiles per second.' }),
    },
    { additionalProperties: false, description: 'Walk faster or slower from here on.' },
  ),
]);
export type MoveStep = Static<typeof MoveStep>;

/** The steps of a route (at least one). */
export const MoveSteps = Type.Array(MoveStep, { minItems: 1 });
