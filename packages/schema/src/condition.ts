import Type, { type Static } from 'typebox';
import { Id } from './common.js';

export const CompareOp = Type.Union([
  Type.Literal('=='),
  Type.Literal('!='),
  Type.Literal('<'),
  Type.Literal('<='),
  Type.Literal('>'),
  Type.Literal('>='),
]);
export type CompareOp = Static<typeof CompareOp>;

/** A test against game state. Used by event page conditions and `if` commands. */
export const Condition = Type.Union([
  Type.Object(
    {
      type: Type.Literal('switch'),
      switch: Id,
      value: Type.Boolean(),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('variable'),
      variable: Id,
      op: CompareOp,
      value: Type.Integer(),
    },
    { additionalProperties: false },
  ),
]);
export type Condition = Static<typeof Condition>;
