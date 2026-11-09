import Type, { type Static } from 'typebox';
import { Id, NonNegativeInt, PositiveInt, RelativePath } from '../common.js';
import {
  DatabaseFile,
  LevelCurve,
  Listed,
  Occasion,
  STAT_KEYS,
  StatBlock,
  type StatKey,
  TargetScope,
} from './common.js';
import { Effect } from './effect.js';
import { Modifier } from './modifier.js';

export const DATABASE_FORMAT_VERSION = 3;

const Named = Type.Object(
  { id: Id, name: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);

/** Sound effects the engine plays itself. Any may be omitted (silence). */
export const SOUND_KEYS = [
  'cursor',
  'confirm',
  'cancel',
  'buzzer',
  'damage',
  'heal',
  'save',
  'battleStart',
] as const;
export type SoundKey = (typeof SOUND_KEYS)[number];

/** Music and sounds for the engine's own screens. Paths are project-relative audio files. */
export const SystemAudio = Type.Object(
  {
    titleMusic: Type.Optional(RelativePath),
    battleMusic: Type.Optional(RelativePath),
    victoryMusic: Type.Optional(RelativePath),
    gameOverMusic: Type.Optional(RelativePath),
    sounds: Type.Optional(
      Type.Partial(
        Type.Object(
          Object.fromEntries(SOUND_KEYS.map((k) => [k, RelativePath])) as Record<
            SoundKey,
            typeof RelativePath
          >,
          { additionalProperties: false },
        ),
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
export type SystemAudio = Static<typeof SystemAudio>;

/** `system.json`: the type lists other database files refer to. */
export const SystemData = Type.Object(
  {
    formatVersion: Type.Literal(DATABASE_FORMAT_VERSION),
    currency: Type.String({ minLength: 1, description: 'Shown after gold amounts, e.g. "G".' }),
    elements: Type.Array(Named),
    equipmentSlots: Type.Array(Named, { description: 'In menu order, e.g. weapon, shield, head.' }),
    equipmentTypes: Type.Array(Named, { description: 'e.g. sword, staff, light armor.' }),
    skillTypes: Type.Array(Named, { description: 'e.g. magic, techniques.' }),
    attackSkill: Type.Optional(Id),
    guardSkill: Type.Optional(Id),
    audio: Type.Optional(SystemAudio),
    iconset: Type.Optional(
      Type.Object(
        { image: RelativePath, iconSize: PositiveInt, columns: PositiveInt },
        { additionalProperties: false },
      ),
    ),
  },
  { title: 'FreeQuest system data', additionalProperties: false },
);
export type SystemData = Static<typeof SystemData>;

export const ExpCurve = Type.Object(
  {
    base: Type.Number({ exclusiveMinimum: 0 }),
    exponent: Type.Number({ minimum: 1 }),
  },
  {
    additionalProperties: false,
    description: 'Total exp to reach level L = round(base * (L - 1) ^ exponent).',
  },
);
export type ExpCurve = Static<typeof ExpCurve>;

export const ClassEntry = Type.Object(
  {
    ...Listed,
    exp: ExpCurve,
    stats: Type.Object(
      Object.fromEntries(STAT_KEYS.map((stat) => [stat, LevelCurve])) as Record<
        StatKey,
        typeof LevelCurve
      >,
      { additionalProperties: false },
    ),
    skills: Type.Array(
      Type.Object({ level: PositiveInt, skill: Id }, { additionalProperties: false }),
      { description: 'Skills learned on reaching a level.' },
    ),
    modifiers: Type.Array(Modifier),
  },
  { additionalProperties: false },
);
export type ClassEntry = Static<typeof ClassEntry>;

export const ActorEntry = Type.Object(
  {
    ...Listed,
    class: Id,
    character: Id,
    level: PositiveInt,
    maxLevel: PositiveInt,
    /** Starting equipment by slot id. */
    equipment: Type.Record(Type.String(), Id),
    modifiers: Type.Array(Modifier),
  },
  { additionalProperties: false },
);
export type ActorEntry = Static<typeof ActorEntry>;

export const HitType = Type.Union(
  [Type.Literal('certain'), Type.Literal('physical'), Type.Literal('magical')],
  { description: 'certain always hits; physical/magical can be evaded.' },
);
export type HitType = Static<typeof HitType>;

const Usable = {
  occasion: Occasion,
  target: TargetScope,
  hitType: HitType,
  successRate: Type.Number({ minimum: 0, maximum: 1 }),
  effects: Type.Array(Effect),
};

export const SkillEntry = Type.Object(
  {
    ...Listed,
    skillType: Type.Optional(Id),
    mpCost: NonNegativeInt,
    ...Usable,
  },
  { additionalProperties: false },
);
export type SkillEntry = Static<typeof SkillEntry>;

export const ItemEntry = Type.Object(
  {
    ...Listed,
    price: NonNegativeInt,
    key: Type.Boolean({ description: 'Key items cannot be sold or discarded.' }),
    consumable: Type.Boolean(),
    ...Usable,
  },
  { additionalProperties: false },
);
export type ItemEntry = Static<typeof ItemEntry>;

export const EquipmentEntry = Type.Object(
  {
    ...Listed,
    price: NonNegativeInt,
    slot: Id,
    equipmentType: Id,
    modifiers: Type.Array(Modifier),
  },
  { additionalProperties: false },
);
export type EquipmentEntry = Static<typeof EquipmentEntry>;

export const StateRestriction = Type.Union(
  [Type.Literal('none'), Type.Literal('cannotAct'), Type.Literal('confused')],
  { description: 'confused: acts on its own against random targets.' },
);
export type StateRestriction = Static<typeof StateRestriction>;

export const StateEntry = Type.Object(
  {
    ...Listed,
    /** Higher priority states show first and win display conflicts. */
    priority: NonNegativeInt,
    restriction: StateRestriction,
    /** True for knockout: the battler counts as defeated while it has this state. */
    knockout: Type.Boolean(),
    removal: Type.Object(
      {
        battleEnd: Type.Boolean(),
        turns: Type.Optional(
          Type.Object({ min: PositiveInt, max: PositiveInt }, { additionalProperties: false }),
        ),
        steps: Type.Optional(PositiveInt),
        damageChance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
      },
      { additionalProperties: false },
    ),
    modifiers: Type.Array(Modifier),
  },
  { additionalProperties: false },
);
export type StateEntry = Static<typeof StateEntry>;

export const DropKind = Type.Union([Type.Literal('item'), Type.Literal('equipment')]);

export const EnemyEntry = Type.Object(
  {
    ...Listed,
    image: Type.Optional(RelativePath),
    stats: StatBlock,
    exp: NonNegativeInt,
    gold: NonNegativeInt,
    drops: Type.Array(
      Type.Object(
        { kind: DropKind, id: Id, chance: Type.Number({ minimum: 0, maximum: 1 }) },
        { additionalProperties: false },
      ),
    ),
    actions: Type.Array(
      Type.Object(
        {
          skill: Id,
          rating: Type.Integer({ minimum: 1, maximum: 9, description: 'Higher = chosen more.' }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    modifiers: Type.Array(Modifier),
  },
  { additionalProperties: false },
);
export type EnemyEntry = Static<typeof EnemyEntry>;

/** A group of enemies fought together. */
export const TroopEntry = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1 }),
    enemies: Type.Array(Id, { minItems: 1, maxItems: 8, description: 'Enemy ids, left to right.' }),
  },
  { additionalProperties: false },
);
export type TroopEntry = Static<typeof TroopEntry>;

const V = DATABASE_FORMAT_VERSION;
export const ActorsFile = DatabaseFile('FreeQuest actors', ActorEntry, V);
export const ClassesFile = DatabaseFile('FreeQuest classes', ClassEntry, V);
export const SkillsFile = DatabaseFile('FreeQuest skills', SkillEntry, V);
export const ItemsFile = DatabaseFile('FreeQuest items', ItemEntry, V);
export const EquipmentFile = DatabaseFile('FreeQuest equipment', EquipmentEntry, V);
export const StatesFile = DatabaseFile('FreeQuest states', StateEntry, V);
export const EnemiesFile = DatabaseFile('FreeQuest enemies', EnemyEntry, V);
export const TroopsFile = DatabaseFile('FreeQuest troops', TroopEntry, V);
