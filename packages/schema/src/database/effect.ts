import Type, { type Static } from 'typebox';
import { Id } from '../common.js';
import { Formula, StatKey } from './common.js';

const Pool = Type.Union([Type.Literal('hp'), Type.Literal('mp')]);

/** What using an item or skill does to each target. Shared by items and skills. */
export const Effect = Type.Union([
  Type.Object(
    {
      type: Type.Literal('damage'),
      pool: Pool,
      formula: Formula,
      /** Element id, or "attack" for the user's attack element. Omit for none. */
      element: Type.Optional(Id),
      variance: Type.Number({ minimum: 0, maximum: 1, description: '0.2 = ±20%.' }),
      critical: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('recover'), pool: Pool, formula: Formula },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('addState'),
      state: Id,
      chance: Type.Number({ minimum: 0, maximum: 1 }),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal('removeState'), state: Id }, { additionalProperties: false }),
  Type.Object({ type: Type.Literal('learnSkill'), skill: Id }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal('buff'),
      stat: StatKey,
      /** Up (+25%) or down (−25%), stacking up to two levels each way. */
      direction: Type.Union([Type.Literal('up'), Type.Literal('down')]),
      /** Turns it lasts (counted at the end of each turn; using it again renews them). */
      turns: Type.Integer({ minimum: 1, maximum: 99 }),
    },
    {
      additionalProperties: false,
      description: 'Raise or lower a stat by 25% for some turns, in battle (v5).',
    },
  ),
  Type.Object(
    { type: Type.Literal('gainTp'), amount: Type.Integer({ minimum: -100, maximum: 100 }) },
    { additionalProperties: false, description: 'Give (or take) the target TP, in battle (v5).' },
  ),
  Type.Object(
    { type: Type.Literal('commonEvent'), common: Id },
    {
      additionalProperties: false,
      description:
        'Run a common event once the skill or item has been used (in battle, or after the menu closes) (v5).',
    },
  ),
]);
export type Effect = Static<typeof Effect>;
