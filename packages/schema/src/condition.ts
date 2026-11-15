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

/** An input action, as events can test it (v9). */
export const InputAction = Type.Union([
  Type.Literal('confirm'),
  Type.Literal('cancel'),
  Type.Literal('menu'),
  Type.Literal('up'),
  Type.Literal('down'),
  Type.Literal('left'),
  Type.Literal('right'),
]);
export type InputAction = Static<typeof InputAction>;

/**
 * Tests only an If command can make (v9): they read things that change
 * without a switch, variable or party change (a key, HP, a facing), which
 * event pages wouldn't notice.
 */
export const BranchTest = Type.Union([
  Type.Object(
    { type: Type.Literal('held'), action: InputAction },
    { additionalProperties: false, description: 'A key (an input action) is held down.' },
  ),
  Type.Object(
    {
      type: Type.Literal('facing'),
      /** "player", "this" (the event running the command) or an event id on this map. */
      target: Id,
      direction: Type.Union([
        Type.Literal('up'),
        Type.Literal('down'),
        Type.Literal('left'),
        Type.Literal('right'),
      ]),
    },
    { additionalProperties: false, description: 'The player or an event faces a direction.' },
  ),
  Type.Object(
    { type: Type.Literal('actorState'), actor: Id, state: Id, value: Type.Boolean() },
    {
      additionalProperties: false,
      description: 'A party member has a state (or not). Actors outside the party have none.',
    },
  ),
  Type.Object(
    {
      type: Type.Literal('actorStat'),
      actor: Id,
      stat: Type.Union([
        Type.Literal('level'),
        Type.Literal('hp'),
        Type.Literal('mp'),
        Type.Literal('hpPercent'),
        Type.Literal('mpPercent'),
      ]),
      op: CompareOp,
      value: Type.Integer({ minimum: 0 }),
    },
    {
      additionalProperties: false,
      description:
        "A party member's level, HP or MP (or HP/MP as a percent of the most). Actors outside the party count as 0.",
    },
  ),
  Type.Object(
    { type: Type.Literal('actorName'), actor: Id, name: Type.String() },
    { additionalProperties: false, description: "An actor's name is this (as changed by events)." },
  ),
]);
export type BranchTest = Static<typeof BranchTest>;

/** What an If command can test: any page condition, and the branch-only tests. */
export const IfCondition = Type.Union([...Condition.anyOf, ...BranchTest.anyOf]);
export type IfCondition = Condition | BranchTest;
