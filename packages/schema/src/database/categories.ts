import Type, { type Static } from 'typebox';
import { ID_PATTERN, Id, NonNegativeInt, PositiveInt, RelativePath } from '../common.js';
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
import { Command } from '../command.js';
import { Effect } from './effect.js';
import { Modifier } from './modifier.js';

export const DATABASE_FORMAT_VERSION = 6;

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
  /** Each battle turn starting (v6). */
  'turnStart',
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
    /** A picture behind battles, scaled to cover the screen (v6); maps and battle commands can have their own. */
    battleBackground: Type.Optional(RelativePath),
    titleScreen: Type.Optional(
      Type.Object(
        {
          image: RelativePath,
          /** Draw the game's name over the picture (off when the picture has it already). */
          showName: Type.Boolean(),
        },
        {
          additionalProperties: false,
          description: 'A picture behind the title screen, scaled to cover the screen (v5).',
        },
      ),
    ),
    balloons: Type.Optional(
      Type.Object(
        {
          image: RelativePath,
          size: PositiveInt,
          frames: PositiveInt,
          names: Type.Array(Type.String({ minLength: 1 }), {
            minItems: 1,
            description: 'One per row of the image, top first.',
          }),
        },
        {
          additionalProperties: false,
          description:
            'Balloons over characters (v5): an image with one balloon per row, each `frames` square frames of `size` pixels, played left to right.',
        },
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
  /** Played on each target in battle (v5). */
  animation: Type.Optional(Id),
  /** TP the user gains each time, in battle (v5). */
  tpGain: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
  /** Hits each target this many times (v5). */
  repeats: Type.Optional(Type.Integer({ minimum: 1, maximum: 9 })),
};

export const SkillEntry = Type.Object(
  {
    ...Listed,
    skillType: Type.Optional(Id),
    mpCost: NonNegativeInt,
    /** TP it costs, in battle (v5): TP runs 0 to 100, from 0 each battle. */
    tpCost: Type.Optional(Type.Integer({ minimum: 0, maximum: 100 })),
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

/** When an enemy may use an action: about itself, or the battle's turn number (1, 2, …). */
export const EnemyCondition = Type.Union([
  Type.Object(
    {
      type: Type.Literal('hp'),
      /** below: HP under this share of max HP. atLeast: this share or more. */
      compare: Type.Union([Type.Literal('below'), Type.Literal('atLeast')]),
      percent: Type.Integer({ minimum: 1, maximum: 100 }),
    },
    { additionalProperties: false, description: 'Its own HP, as a share of its max HP.' },
  ),
  Type.Object(
    {
      type: Type.Literal('turn'),
      /** The first turn it may be used on. */
      from: PositiveInt,
      /** Then every this many turns (0 = only on that turn). */
      every: NonNegativeInt,
    },
    { additionalProperties: false, description: 'Turn numbers, e.g. from 2, every 3: 2, 5, 8…' },
  ),
  Type.Object(
    {
      type: Type.Literal('state'),
      state: Id,
      /** true: only while it has the state. false: only while it doesn't. */
      has: Type.Boolean(),
    },
    { additionalProperties: false, description: 'A state on the enemy itself.' },
  ),
]);
export type EnemyCondition = Static<typeof EnemyCondition>;

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
          /** All must hold for the enemy to consider this action (none = always). */
          conditions: Type.Array(EnemyCondition),
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
/**
 * A troop's battle event (v5): commands that run during its battles when
 * every given condition holds, checked as each turn starts (or, with
 * `turnEnd`, as it ends). A page with no conditions never runs.
 */
export const TroopEvent = Type.Object(
  {
    conditions: Type.Object(
      {
        /** The turn starting (or ending): from turn N, then every M (0 = only that turn). */
        turn: Type.Optional(
          Type.Object(
            { from: PositiveInt, every: NonNegativeInt },
            { additionalProperties: false },
          ),
        ),
        /** Checked as the turn ends instead of as it starts. */
        turnEnd: Type.Optional(Type.Boolean()),
        /** An enemy of the troop (0 = the first, left) at or below this percent of its HP. */
        enemyHp: Type.Optional(
          Type.Object(
            { enemy: NonNegativeInt, below: Type.Integer({ minimum: 0, maximum: 100 }) },
            { additionalProperties: false },
          ),
        ),
        /** A party member in the battle at or below this percent of their HP. */
        actorHp: Type.Optional(
          Type.Object(
            { actor: Id, below: Type.Integer({ minimum: 0, maximum: 100 }) },
            { additionalProperties: false },
          ),
        ),
        switch: Type.Optional(Id),
      },
      { additionalProperties: false },
    ),
    /** How often it runs: once a battle, once a turn, or every time it's checked and holds. */
    span: Type.Union([Type.Literal('battle'), Type.Literal('turn'), Type.Literal('moment')]),
    commands: Type.Array(Command),
  },
  { additionalProperties: false },
);
export type TroopEvent = Static<typeof TroopEvent>;

export const TroopEntry = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1 }),
    enemies: Type.Array(Id, { minItems: 1, maxItems: 8, description: 'Enemy ids, left to right.' }),
    /**
     * Where each enemy stands on the battle screen, in the order of `enemies`:
     * its feet, in pixels of the game screen (v6). Without it (or when the
     * counts differ), the enemies stand in an even row.
     */
    places: Type.Optional(
      Type.Array(
        Type.Object({ x: Type.Integer(), y: Type.Integer() }, { additionalProperties: false }),
        { maxItems: 8 },
      ),
    ),
    events: Type.Optional(Type.Array(TroopEvent)),
  },
  { additionalProperties: false },
);
export type TroopEntry = Static<typeof TroopEntry>;

/**
 * Commands kept in one place and shared: called from any event with
 * `callCommon`, or started by the game itself (autorun, parallel) while
 * their switch is on.
 */
export const CommonEventEntry = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1 }),
    trigger: Type.Union([Type.Literal('call'), Type.Literal('autorun'), Type.Literal('parallel')], {
      description:
        'call: only when an event calls it. autorun: runs when nothing else does. parallel: runs alongside play.',
    }),
    switch: Type.Optional(
      Type.String({
        pattern: ID_PATTERN,
        description: 'For autorun and parallel: runs only while this switch is on.',
      }),
    ),
    commands: Type.Array(Command),
  },
  { additionalProperties: false },
);
export type CommonEventEntry = Static<typeof CommonEventEntry>;

/**
 * An animation (v5): frames cut from a sheet (left to right, then down), played at `fps`,
 * centred on a character or a battler, with sounds at chosen frames. Without an image it
 * only plays its sounds and takes its time (a stand-in to draw later).
 */
export const AnimationEntry = Type.Object(
  {
    id: Id,
    name: Type.String({ minLength: 1 }),
    image: Type.Optional(RelativePath),
    frameWidth: PositiveInt,
    frameHeight: PositiveInt,
    frames: PositiveInt,
    fps: Type.Number({ minimum: 1, maximum: 60, description: 'Frames per second.' }),
    sounds: Type.Array(
      Type.Object({ frame: NonNegativeInt, path: RelativePath }, { additionalProperties: false }),
    ),
    note: Type.Optional(Type.String({ description: 'For authors; never shown in the game.' })),
  },
  { additionalProperties: false },
);
export type AnimationEntry = Static<typeof AnimationEntry>;

/** How long an animation plays, in seconds. */
export function animationSeconds(entry: Pick<AnimationEntry, 'frames' | 'fps'>): number {
  return entry.frames / entry.fps;
}

const V = DATABASE_FORMAT_VERSION;
export const ActorsFile = DatabaseFile('FreeQuest actors', ActorEntry, V);
export const ClassesFile = DatabaseFile('FreeQuest classes', ClassEntry, V);
export const SkillsFile = DatabaseFile('FreeQuest skills', SkillEntry, V);
export const ItemsFile = DatabaseFile('FreeQuest items', ItemEntry, V);
export const EquipmentFile = DatabaseFile('FreeQuest equipment', EquipmentEntry, V);
export const StatesFile = DatabaseFile('FreeQuest states', StateEntry, V);
export const EnemiesFile = DatabaseFile('FreeQuest enemies', EnemyEntry, V);
export const TroopsFile = DatabaseFile('FreeQuest troops', TroopEntry, V);
export const CommonEventsFile = DatabaseFile('FreeQuest common events', CommonEventEntry, V);
export const AnimationsFile = DatabaseFile('FreeQuest animations', AnimationEntry, V);
