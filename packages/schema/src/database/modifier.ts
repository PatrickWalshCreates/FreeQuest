import Type, { type Static } from 'typebox';
import { Id } from '../common.js';
import { StatKey } from './common.js';

/**
 * A rule that changes a battler. Classes, equipment, states and enemies all
 * carry a list of these; a battler's effective values combine every modifier
 * that applies to it.
 */
export const Modifier = Type.Union([
  Type.Object(
    {
      type: Type.Literal('statRate'),
      stat: StatKey,
      value: Type.Number({ minimum: 0, description: 'Multiplier, e.g. 1.1 for +10%.' }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('statFlat'), stat: StatKey, value: Type.Integer() },
    { additionalProperties: false, description: 'Added to the stat after rates.' },
  ),
  Type.Object(
    {
      type: Type.Literal('elementRate'),
      element: Id,
      value: Type.Number({ minimum: 0, description: 'Damage taken multiplier.' }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('stateRate'),
      state: Id,
      value: Type.Number({ minimum: 0, description: 'Chance multiplier; 0 = immune.' }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { type: Type.Literal('attackElement'), element: Id },
    { additionalProperties: false, description: 'Element of normal attacks.' },
  ),
  Type.Object(
    { type: Type.Literal('equipType'), equipmentType: Id },
    { additionalProperties: false, description: 'Allows equipping this equipment type.' },
  ),
  Type.Object(
    {
      type: Type.Literal('hpRegen'),
      value: Type.Number({
        minimum: -1,
        maximum: 1,
        description: 'Fraction of max HP gained each turn; negative for poison.',
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Union([
        Type.Literal('hitRate'),
        Type.Literal('evasionRate'),
        Type.Literal('criticalRate'),
      ]),
      value: Type.Number({
        minimum: -1,
        maximum: 1,
        description: 'Added to the base chance (hit 0.95, evasion 0.05, critical 0.04).',
      }),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('damageTaken'),
      value: Type.Number({
        minimum: 0,
        description: 'Multiplier on HP damage taken, e.g. 0.5 when guarding.',
      }),
    },
    { additionalProperties: false },
  ),
]);
export type Modifier = Static<typeof Modifier>;
