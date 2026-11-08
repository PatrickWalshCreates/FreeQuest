import Type, { type Static, type TSchema } from 'typebox';
import { Id, NonNegativeInt } from '../common.js';

/** The eight core stats every battler has. */
export const STAT_KEYS = [
  'maxHp',
  'maxMp',
  'attack',
  'defense',
  'magicAttack',
  'magicDefense',
  'agility',
  'luck',
] as const;
export const StatKey = Type.Union(STAT_KEYS.map((k) => Type.Literal(k)));
export type StatKey = (typeof STAT_KEYS)[number];

/** A value for each stat. */
export const StatBlock = Type.Object(
  Object.fromEntries(STAT_KEYS.map((k) => [k, NonNegativeInt])) as Record<
    StatKey,
    typeof NonNegativeInt
  >,
  { additionalProperties: false },
);
export type StatBlock = Static<typeof StatBlock>;

/**
 * Value by level: a few (level → value) points, straight lines between them,
 * flat beyond the ends. Must include level 1. E.g. { "1": 450, "99": 9000 }.
 */
export const LevelCurve = Type.Record(Type.Integer({ minimum: 1 }), NonNegativeInt, {
  additionalProperties: false,
  minProperties: 1,
});
export type LevelCurve = Static<typeof LevelCurve>;

/** A damage/recovery formula in FreeQuest's formula language (never evaluated as JavaScript). */
export const Formula = Type.String({
  minLength: 1,
  description: 'e.g. "a.attack * 4 - b.defense * 2". a = user, b = target, v.<id> = variable.',
});

/** Index into the iconset image declared in system.json. */
export const Icon = NonNegativeInt;

/** Who an item or skill affects. */
export const TargetScope = Type.Union([
  Type.Object({ side: Type.Literal('none') }, { additionalProperties: false }),
  Type.Object({ side: Type.Literal('user') }, { additionalProperties: false }),
  Type.Object(
    {
      side: Type.Union([Type.Literal('ally'), Type.Literal('enemy')]),
      select: Type.Union([Type.Literal('one'), Type.Literal('all')]),
      /** Target knocked-out allies (e.g. revive). Only meaningful for side "ally". */
      dead: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      side: Type.Literal('enemy'),
      select: Type.Literal('random'),
      count: Type.Integer({ minimum: 1 }),
    },
    { additionalProperties: false },
  ),
]);
export type TargetScope = Static<typeof TargetScope>;

export const Occasion = Type.Union(
  [Type.Literal('always'), Type.Literal('battle'), Type.Literal('menu'), Type.Literal('never')],
  { description: 'Where it can be used.' },
);
export type Occasion = Static<typeof Occasion>;

/** Common fields of everything that appears in lists and menus. */
export const Listed = {
  id: Id,
  name: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
  icon: Type.Optional(Icon),
};

/** Envelope of every database category file: `{ formatVersion, entries: [...] }`. */
export function DatabaseFile<T extends TSchema>(title: string, entry: T, version: number) {
  return Type.Object(
    { formatVersion: Type.Literal(version), entries: Type.Array(entry) },
    { title, additionalProperties: false },
  );
}
