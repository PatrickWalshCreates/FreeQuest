import Type, { type Static } from 'typebox';
import { Id } from '../common.js';
import { Formula } from './common.js';

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
]);
export type Effect = Static<typeof Effect>;
