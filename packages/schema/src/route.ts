import Type, { type Static } from 'typebox';
import { Id, RelativePath } from './common.js';

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
    Type.Literal('backward'),
    Type.Literal('down-left'),
    Type.Literal('down-right'),
    Type.Literal('up-left'),
    Type.Literal('up-right'),
  ],
  {
    description:
      'forward: the way the character faces; backward: away from it, still facing it; the four diagonals move one tile both ways (v9); the player ones are worked out at the time.',
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
  Type.Literal('clockwise'),
  Type.Literal('counterclockwise'),
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
  Type.Object(
    {
      type: Type.Literal('jump'),
      x: Type.Integer({
        minimum: -8,
        maximum: 8,
        description: 'Tiles to the right (left if negative).',
      }),
      y: Type.Integer({ minimum: -8, maximum: 8, description: 'Tiles down (up if negative).' }),
    },
    {
      additionalProperties: false,
      description: 'Jump to a tile nearby, or on the spot (0, 0) (v9).',
    },
  ),
  Type.Object(
    { type: Type.Literal('character'), character: Id },
    { additionalProperties: false, description: 'Look like another character from here on (v9).' },
  ),
  Type.Object(
    { type: Type.Literal('through'), on: Type.Boolean() },
    {
      additionalProperties: false,
      description: 'Walk through walls and characters, or stop doing so (v9).',
    },
  ),
  Type.Object(
    { type: Type.Literal('fixFacing'), on: Type.Boolean() },
    {
      additionalProperties: false,
      description: 'Keep facing one way while moving and turning, or stop (v9).',
    },
  ),
  Type.Object(
    { type: Type.Literal('walkAnimation'), on: Type.Boolean() },
    {
      additionalProperties: false,
      description: 'Animate the legs while walking (on by default) (v9).',
    },
  ),
  Type.Object(
    { type: Type.Literal('stepAnimation'), on: Type.Boolean() },
    { additionalProperties: false, description: 'Keep stepping in place even when standing (v9).' },
  ),
  Type.Object(
    { type: Type.Literal('hidden'), on: Type.Boolean() },
    {
      additionalProperties: false,
      description: 'Become invisible (still there), or visible again (v9).',
    },
  ),
  Type.Object(
    { type: Type.Literal('sound'), path: RelativePath },
    { additionalProperties: false, description: 'Play a sound (v9).' },
  ),
  Type.Object(
    { type: Type.Literal('switch'), switch: Id, value: Type.Boolean() },
    { additionalProperties: false, description: 'Turn a switch on or off (v9).' },
  ),
]);
export type MoveStep = Static<typeof MoveStep>;

/** The steps of a route (at least one). */
export const MoveSteps = Type.Array(MoveStep, { minItems: 1 });
