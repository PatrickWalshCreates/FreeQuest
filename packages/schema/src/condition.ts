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
  Type.Object(
    { type: Type.Literal('gold'), op: CompareOp, value: Type.Integer({ minimum: 0 }) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      type: Type.Literal('hasItem'),
      kind: Type.Union([Type.Literal('item'), Type.Literal('equipment')]),
      id: Id,
      /** At least this many (default 1). */
      count: Type.Optional(Type.Integer({ minimum: 1 })),
      /** For equipment: also count pieces worn by party members. */
      includeEquipped: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object({ type: Type.Literal('inParty'), actor: Id }, { additionalProperties: false }),
  Type.Object(
    {
      type: Type.Literal('flag'),
      /** One of this event's own flags (unset flags are off). */
      flag: Id,
      value: Type.Boolean(),
    },
    {
      additionalProperties: false,
      description: 'One of this event\'s own flags, e.g. a chest\'s "opened".',
    },
  ),
]);
export type Condition = Static<typeof Condition>;
