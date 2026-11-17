// MZ's database as FreeQuest's: every category but common events (which come
// with events). Each entry keeps its name; ids come from names (`MzList`).
// Things FreeQuest does differently or lacks are reported per entry.
import {
  DATABASE_FORMAT_VERSION,
  type ActorEntry,
  type ClassEntry,
  type Effect,
  type EnemyCondition,
  type EnemyEntry,
  type EquipmentEntry,
  type HitType,
  type ItemEntry,
  type LevelCurve,
  type Occasion,
  STAT_KEYS,
  type SkillEntry,
  type StatKey,
  type StateEntry,
  type SystemData,
  type TargetScope,
  type TroopEntry,
} from '@freequest/schema';
import { asArray, asInt, asRecord, asString, type JsonRecord } from './json.js';
import type { NumberedIds } from './ids.js';
import type { MzDatabase } from './mz-lists.js';
import type { ImportReport } from './report.js';
import type { SystemTypes } from './system-types.js';
import { PARAM_STATS, flatStats, traitModifiers, type TraitContext } from './traits.js';
import { translateFormula } from './formula.js';

export interface DatabaseContext extends TraitContext {
  readonly db: MzDatabase;
  readonly types: SystemTypes;
  readonly variables: NumberedIds;
  readonly report: ImportReport;
  /** Actor number → its character's id (null: none, the placeholder is used). */
  readonly actorCharacter: (n: number) => string | null;
  /** Enemy number → its battle image (null: none). */
  readonly enemyImage: (n: number) => string | null;
  /** The character for actors without one (the template's). */
  readonly placeholderCharacter: string;
  /** Called when something uses the placeholder character. */
  readonly usedPlaceholder: () => void;
  /** MZ animation `n`'s id (marking it used), or null. */
  readonly animation: (n: number) => string | null;
  /** MZ common event `n`'s id, or null when there's no such common event. */
  readonly common: (n: number) => string | null;
}

export interface ImportedDatabase {
  readonly actors: ActorEntry[];
  readonly classes: ClassEntry[];
  readonly skills: SkillEntry[];
  readonly items: ItemEntry[];
  readonly equipment: EquipmentEntry[];
  readonly states: StateEntry[];
  readonly enemies: EnemyEntry[];
  readonly troops: TroopEntry[];
  /** For system.json (the type lists are added once everything has used them). */
  readonly attackSkill?: string;
  readonly guardSkill?: string;
}

const num = (v: unknown, fallback = 0) =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback;

/** The optional fields every listed entry shares. */
function listed(entry: JsonRecord): { description?: string; icon?: number } {
  const description = asString(entry['description']).trim();
  const icon = asInt(entry['iconIndex']);
  return { ...(description ? { description } : {}), ...(icon > 0 ? { icon } : {}) };
}

export function importDatabase(ctx: DatabaseContext): ImportedDatabase {
  const { db } = ctx;
  const states = [...db.states].map((s) => importState(s.n, s.id, s.name, s.entry, ctx));
  const skills = [...db.skills].map((s) => importSkill(s.id, s.name, s.entry, ctx));
  const items = [...db.items].map((s) => importItem(s.id, s.name, s.entry, ctx));
  const equipment = [
    ...[...db.weapons].map((w) => importEquipment(w.id, w.name, w.entry, 'weapon', ctx)),
    ...[...db.armors].map((a) => importEquipment(a.id, a.name, a.entry, 'armor', ctx)),
  ];
  const classes = [...db.classes].map((c) => importClass(c.id, c.name, c.entry, ctx));
  const actors = [...db.actors].map((a) =>
    importActor(a.n, a.id, a.name, a.entry, equipment, classes, ctx),
  );
  const enemies = [...db.enemies].map((e) => importEnemy(e.n, e.id, e.name, e.entry, ctx));
  const troops = [...db.troops].flatMap((t) => importTroop(t.id, t.name, t.entry, ctx));

  if (classes.length > 0) {
    ctx.report.changed(
      'Classes',
      'FreeQuest works out the experience for each level with a simpler curve; every class got one from its base value. Check how fast characters level up.',
    );
  }
  // MZ's first two skills are the normal attack and guard.
  const attackSkill = db.skills.id(1);
  const guardSkill = db.skills.id(2);
  return {
    actors,
    classes,
    skills,
    items,
    equipment,
    states,
    enemies,
    troops,
    ...(attackSkill ? { attackSkill } : {}),
    ...(guardSkill ? { guardSkill } : {}),
  };
}

// --- States -----------------------------------------------------------------

function importState(
  n: number,
  id: string,
  name: string,
  s: JsonRecord,
  ctx: DatabaseContext,
): StateEntry {
  const where = `States › ${name}`;
  const restriction = asInt(s['restriction']);
  if (restriction === 1 || restriction === 3) {
    ctx.report.changed(
      where,
      `It made the battler attack ${restriction === 1 ? 'enemies' : 'allies'}; FreeQuest's "confused" attacks anyone.`,
    );
  }
  const timing = asInt(s['autoRemovalTiming']);
  const min = Math.max(1, asInt(s['minTurns'], 1));
  const max = Math.max(min, asInt(s['maxTurns'], min));
  if (timing === 1) {
    ctx.report.changed(where, 'It wore off after actions; in FreeQuest it wears off after turns.');
  }
  const steps = asInt(s['stepsToRemove']);
  const removal: StateEntry['removal'] = {
    battleEnd: s['removeAtBattleEnd'] === true,
    ...(timing > 0 ? { turns: { min, max } } : {}),
    ...(s['removeByWalking'] === true && steps > 0 ? { steps } : {}),
    ...(s['removeByDamage'] === true
      ? { damageChance: clamp(num(s['chanceByDamage'], 100) / 100, 0, 1) }
      : {}),
  };
  return {
    id,
    name,
    ...listed(s),
    priority: Math.max(0, asInt(s['priority'])),
    restriction: restriction === 4 ? 'cannotAct' : restriction === 0 ? 'none' : 'confused',
    // MZ's state 1 is always knockout.
    knockout: n === 1,
    removal,
    modifiers: traitModifiers(s['traits'], ctx, where, false).modifiers,
  };
}

// --- Skills and items -------------------------------------------------------

const SCOPES: Readonly<Record<number, TargetScope>> = {
  0: { side: 'none' },
  1: { side: 'enemy', select: 'one' },
  2: { side: 'enemy', select: 'all' },
  3: { side: 'enemy', select: 'random', count: 1 },
  4: { side: 'enemy', select: 'random', count: 2 },
  5: { side: 'enemy', select: 'random', count: 3 },
  6: { side: 'enemy', select: 'random', count: 4 },
  7: { side: 'ally', select: 'one' },
  8: { side: 'ally', select: 'all' },
  9: { side: 'ally', select: 'one', dead: true },
  10: { side: 'ally', select: 'all', dead: true },
  11: { side: 'user' },
};

function scope(n: number, where: string, ctx: DatabaseContext): TargetScope {
  const known = SCOPES[n];
  if (known) return known;
  if (n === 12 || n === 13) {
    ctx.report.changed(
      where,
      'It targeted allies whether knocked out or not; now only standing allies.',
    );
    return { side: 'ally', select: n === 12 ? 'one' : 'all' };
  }
  if (n === 14) {
    ctx.report.changed(where, 'It targeted everyone; now all enemies.');
    return { side: 'enemy', select: 'all' };
  }
  return { side: 'none' };
}

const OCCASIONS: readonly Occasion[] = ['always', 'battle', 'menu', 'never'];
const HIT_TYPES: readonly HitType[] = ['certain', 'physical', 'magical'];

/** What MZ's "damage" block and "effects" list do, as FreeQuest effects. */
function usableEffects(entry: JsonRecord, where: string, ctx: DatabaseContext): Effect[] {
  const effects: Effect[] = [];
  const damage = asRecord(entry['damage']);
  const type = asInt(damage['type']);
  if (type > 0) {
    const source = asString(damage['formula']);
    const translated = translateFormula(source, (n) => ctx.variables.id(n));
    let formula: string;
    if (translated.ok) formula = translated.formula;
    else {
      formula =
        asInt(entry['hitType']) === 2
          ? 'a.magicAttack * 2 - b.magicDefense'
          : 'a.attack * 4 - b.defense * 2';
      ctx.report.changed(
        where,
        `Its formula \`${source.trim()}\` couldn't be translated (${translated.reason}); it uses ${formula} for now.`,
        [{ name: 'Damage formulas to rewrite', count: 1 }],
      );
    }
    const pool = type === 2 || type === 4 || type === 6 ? 'mp' : 'hp';
    if (type === 3 || type === 4) effects.push({ type: 'recover', pool, formula });
    else {
      const elementId = asInt(damage['elementId']);
      effects.push({
        type: 'damage',
        pool,
        formula,
        ...(elementId === -1
          ? { element: 'attack' }
          : elementId > 0
            ? { element: ctx.types.elements.id(elementId) }
            : {}),
        variance: clamp(asInt(damage['variance']) / 100, 0, 1),
        critical: damage['critical'] === true,
      });
      if (type >= 5)
        ctx.report.changed(where, "It drained; now it only damages (the user doesn't gain).");
    }
  }

  const left = new Set<string>();
  for (const raw of asArray(entry['effects'])) {
    const e = asRecord(raw);
    const code = asInt(e['code']);
    const data = asInt(e['dataId']);
    const v1 = num(e['value1']);
    const v2 = num(e['value2']);
    switch (code) {
      case 11:
      case 12: {
        const pool = code === 11 ? 'hp' : 'mp';
        const max = code === 11 ? 'b.maxHp' : 'b.maxMp';
        const parts = [
          v1 !== 0 ? `${max} * ${round(v1)}` : '',
          v2 !== 0 ? String(Math.round(v2)) : '',
        ].filter(Boolean);
        if (parts.length > 0) effects.push({ type: 'recover', pool, formula: parts.join(' + ') });
        break;
      }
      case 21:
      case 22: {
        // State 0 means "the normal attack's states", which come from traits
        // FreeQuest doesn't have (reported there).
        if (data === 0) break;
        const state = ctx.db.states.id(data);
        if (!state) left.add(`missing state ${data}`);
        else if (code === 21) effects.push({ type: 'addState', state, chance: clamp(v1, 0, 1) });
        else effects.push({ type: 'removeState', state });
        break;
      }
      case 13:
        if (Math.round(v1) !== 0) {
          effects.push({ type: 'gainTp', amount: clamp(Math.round(v1), -100, 100) });
        }
        break;
      case 31:
      case 32: {
        const stat = BUFF_STATS[data];
        if (!stat) left.add(code === 31 ? 'buffs' : 'debuffs');
        else {
          effects.push({
            type: 'buff',
            stat,
            direction: code === 31 ? 'up' : 'down',
            turns: clamp(Math.round(v1) || 1, 1, 99),
          });
        }
        break;
      }
      case 44: {
        const common = ctx.common(data);
        if (common) effects.push({ type: 'commonEvent', common });
        else left.add(`calling missing common event ${data}`);
        break;
      }
      case 43: {
        const skill = ctx.db.skills.id(data);
        if (skill) effects.push({ type: 'learnSkill', skill });
        else left.add(`learning missing skill ${data}`);
        break;
      }
      default:
        left.add(EFFECTS[code] ?? `effect ${code}`);
    }
  }
  if (left.size > 0)
    ctx.report.missing(
      where,
      `Effects FreeQuest doesn't have: ${[...left].join(', ')}.`,
      [...left].map((name) => ({ name: `Effect: ${name}`, count: 1 })),
    );
  return effects;
}

/** MZ's parameter numbers (for buffs) as FreeQuest's stats. */
const BUFF_STATS: Readonly<Record<number, StatKey>> = {
  0: 'maxHp',
  1: 'maxMp',
  2: 'attack',
  3: 'defense',
  4: 'magicAttack',
  5: 'magicDefense',
  6: 'agility',
  7: 'luck',
};

const EFFECTS: Readonly<Record<number, string>> = {
  33: 'removing buffs',
  34: 'removing debuffs',
  41: 'escaping',
  42: 'permanent stat growth',
  44: 'calling a common event',
};

function usable(entry: JsonRecord, where: string, ctx: DatabaseContext) {
  return {
    occasion: OCCASIONS[asInt(entry['occasion'])] ?? 'always',
    target: scope(asInt(entry['scope']), where, ctx),
    hitType: HIT_TYPES[asInt(entry['hitType'])] ?? 'certain',
    successRate: clamp(asInt(entry['successRate'], 100) / 100, 0, 1),
    effects: usableEffects(entry, where, ctx),
    ...animationOf(entry, ctx),
    ...(asInt(entry['tpGain']) > 0 ? { tpGain: clamp(asInt(entry['tpGain']), 0, 100) } : {}),
    ...(asInt(entry['repeats'], 1) > 1 ? { repeats: clamp(asInt(entry['repeats']), 1, 9) } : {}),
  };
}

/**
 * A skill's or item's animation: its own, or for "the normal attack" (-1) the
 * attack skill's (MZ's skill 1).
 */
function animationOf(entry: JsonRecord, ctx: DatabaseContext): { animation?: string } {
  let n = asInt(entry['animationId']);
  if (n < 0) n = asInt(ctx.db.skills.entries.get(1)?.['animationId']);
  const id = n > 0 ? ctx.animation(n) : null;
  return id ? { animation: id } : {};
}

function importSkill(id: string, name: string, s: JsonRecord, ctx: DatabaseContext): SkillEntry {
  const where = `Skills › ${name}`;
  const type = asInt(s['stypeId']);
  const tpCost = clamp(asInt(s['tpCost']), 0, 100);
  return {
    id,
    name,
    ...listed(s),
    ...(type > 0 ? { skillType: ctx.types.skillTypes.id(type) } : {}),
    mpCost: Math.max(0, asInt(s['mpCost'])),
    ...(tpCost > 0 ? { tpCost } : {}),
    ...usable(s, where, ctx),
  };
}

function importItem(id: string, name: string, s: JsonRecord, ctx: DatabaseContext): ItemEntry {
  const where = `Items › ${name}`;
  const kind = asInt(s['itypeId'], 1);
  if (kind === 3 || kind === 4)
    ctx.report.changed(where, 'It was a hidden item; FreeQuest shows it in the bag.');
  return {
    id,
    name,
    ...listed(s),
    price: Math.max(0, asInt(s['price'])),
    key: kind === 2,
    consumable: s['consumable'] !== false,
    ...usable(s, where, ctx),
  };
}

function importEquipment(
  id: string,
  name: string,
  s: JsonRecord,
  kind: 'weapon' | 'armor',
  ctx: DatabaseContext,
): EquipmentEntry {
  const where = `${kind === 'weapon' ? 'Weapons' : 'Armors'} › ${name}`;
  const type =
    kind === 'weapon'
      ? ctx.types.weaponTypes.id(asInt(s['wtypeId']))
      : ctx.types.armorTypes.id(asInt(s['atypeId']));
  return {
    id,
    name,
    ...listed(s),
    price: Math.max(0, asInt(s['price'])),
    slot: ctx.types.equipmentSlots.id(Math.max(1, asInt(s['etypeId'], kind === 'weapon' ? 1 : 2))),
    equipmentType: type,
    modifiers: [
      ...flatStats(s['params']),
      ...traitModifiers(s['traits'], ctx, where, false).modifiers,
    ],
  };
}

// --- Classes and actors -----------------------------------------------------

function importClass(id: string, name: string, c: JsonRecord, ctx: DatabaseContext): ClassEntry {
  const where = `Classes › ${name}`;
  const params = asArray(c['params']);
  const stats = Object.fromEntries(
    PARAM_STATS.map((stat, i) => [stat, levelCurve(asArray(params[i]))]),
  ) as Record<StatKey, LevelCurve>;
  for (const stat of STAT_KEYS) stats[stat] ??= { 1: 1 };
  const traits = traitModifiers(c['traits'], ctx, where, true);
  const skills: ClassEntry['skills'] = traits.skills.map((skill) => ({ level: 1, skill }));
  for (const raw of asArray(c['learnings'])) {
    const learning = asRecord(raw);
    const skill = ctx.db.skills.id(asInt(learning['skillId']));
    if (skill) skills.push({ level: Math.max(1, asInt(learning['level'], 1)), skill });
  }
  const exp = asArray(c['expParams']);
  return {
    id,
    name,
    exp: { base: Math.max(1, num(exp[0], 30)), exponent: 2 },
    stats,
    skills,
    modifiers: traits.modifiers,
  };
}

/**
 * A level curve with only the points needed: MZ stores a value for every
 * level, FreeQuest draws straight lines between a few. Points are added where
 * the lines stray most until every level is within half a percent (and under
 * a point for small values), so a curve stays short enough to read and edit.
 */
export function levelCurve(values: readonly unknown[]): LevelCurve {
  const byLevel: number[] = [];
  for (let level = 1; level < values.length; level++)
    byLevel[level] = Math.max(0, asInt(values[level]));
  const last = byLevel.length - 1;
  if (last < 1) return { 1: 1 };
  const keep = new Set([1, last]);
  const split = (from: number, to: number) => {
    const v0 = byLevel[from] ?? 0;
    const v1 = byLevel[to] ?? 0;
    let worst = 0;
    let at = -1;
    for (let level = from + 1; level < to; level++) {
      const line = v0 + ((v1 - v0) * (level - from)) / (to - from);
      const off = Math.abs(line - (byLevel[level] ?? 0));
      if (off > worst) [worst, at] = [off, level];
    }
    const allowed = Math.max(0.5, (byLevel[at] ?? 0) * 0.005);
    if (worst >= allowed && at > 0) {
      keep.add(at);
      split(from, at);
      split(at, to);
    }
  };
  split(1, last);
  return Object.fromEntries([...keep].sort((a, b) => a - b).map((l) => [l, byLevel[l] ?? 0]));
}

function importActor(
  n: number,
  id: string,
  name: string,
  a: JsonRecord,
  equipment: readonly EquipmentEntry[],
  classes: readonly ClassEntry[],
  ctx: DatabaseContext,
): ActorEntry {
  const where = `Actors › ${name}`;
  const classId = ctx.db.classes.id(asInt(a['classId'])) ?? classes[0]?.id ?? 'none';
  if (!ctx.db.classes.has(asInt(a['classId'])))
    ctx.report.changed(where, 'Its class is missing; it got the first class.');
  const traits = traitModifiers(a['traits'], ctx, where, false);
  if (traits.skills.length > 0)
    ctx.report.missing(
      where,
      'Skills added by the actor’s own traits: give them through the class.',
    );
  const level = Math.max(1, asInt(a['initialLevel'], 1));
  const maxLevel = Math.max(level, asInt(a['maxLevel'], 99));

  // Starting equipment: equips[0] is a weapon, the rest armors. Each goes in
  // the slot it belongs to (its own equipment type), whatever position it had.
  const allowed = new Set(
    [...traits.modifiers, ...(classes.find((c) => c.id === classId)?.modifiers ?? [])].flatMap(
      (m) => (m.type === 'equipType' ? [m.equipmentType] : []),
    ),
  );
  const start: Record<string, string> = {};
  asArray(a['equips']).forEach((raw, i) => {
    const n = asInt(raw);
    if (n <= 0) return;
    const itemId = i === 0 ? ctx.db.weapons.id(n) : ctx.db.armors.id(n);
    const item = equipment.find((e) => e.id === itemId);
    // MZ data can list the same item again in another position: it's on already.
    if (!item || start[item.slot] === item.id) return;
    if (!allowed.has(item.equipmentType) || start[item.slot]) {
      ctx.report.changed(
        where,
        `It can't wear its starting “${item.name}” in FreeQuest (its class doesn't allow that type, or the slot is taken), so it starts without it.`,
      );
      return;
    }
    start[item.slot] = item.id;
  });
  const profile = asString(a['profile']).trim();
  return {
    id,
    name,
    ...(profile ? { description: profile } : {}),
    class: classId,
    character: actorCharacter(n, where, ctx),
    level,
    maxLevel,
    equipment: start,
    modifiers: traits.modifiers,
  };
}

// --- Enemies and troops -----------------------------------------------------

function actorCharacter(n: number, where: string, ctx: DatabaseContext): string {
  const character = ctx.actorCharacter(n);
  if (character) return character;
  ctx.report.changed(where, 'It has no character picture, so it uses the Starter’s hero.');
  ctx.usedPlaceholder();
  return ctx.placeholderCharacter;
}

function importEnemy(
  n: number,
  id: string,
  name: string,
  e: JsonRecord,
  ctx: DatabaseContext,
): EnemyEntry {
  const where = `Enemies › ${name}`;
  const image = ctx.enemyImage(n);
  if (image && asInt(e['battlerHue']) !== 0) {
    ctx.report.changed(
      where,
      'Its picture was recoloured (hue); FreeQuest shows the original colours.',
    );
  }
  const params = asArray(e['params']);
  const stats = Object.fromEntries(
    PARAM_STATS.map((stat, i) => [stat, Math.max(stat === 'maxHp' ? 1 : 0, asInt(params[i]))]),
  ) as Record<StatKey, number>;
  const drops: EnemyEntry['drops'] = [];
  for (const raw of asArray(e['dropItems'])) {
    const d = asRecord(raw);
    const kind = asInt(d['kind']);
    const n = asInt(d['dataId']);
    const chance = clamp(1 / Math.max(1, asInt(d['denominator'], 1)), 0, 1);
    const dropId =
      kind === 1
        ? ctx.db.items.id(n)
        : kind === 2
          ? ctx.db.weapons.id(n)
          : kind === 3
            ? ctx.db.armors.id(n)
            : null;
    if (dropId) drops.push({ kind: kind === 1 ? 'item' : 'equipment', id: dropId, chance });
  }
  const dropped = new Set<string>();
  const actions: EnemyEntry['actions'] = [];
  for (const raw of asArray(e['actions'])) {
    const act = asRecord(raw);
    const skill = ctx.db.skills.id(asInt(act['skillId']));
    if (!skill) continue;
    const conditions = enemyConditions(act, ctx, dropped);
    if (conditions === null) continue;
    actions.push({ skill, rating: clamp(asInt(act['rating'], 5), 1, 9), conditions });
  }
  if (dropped.size > 0) {
    ctx.report.changed(
      where,
      `Action conditions FreeQuest doesn't have were left off (${[...dropped].join(', ')}): those actions can happen any time.`,
    );
  }
  const attack = ctx.db.skills.id(1);
  if (actions.length === 0 && attack) {
    actions.push({ skill: attack, rating: 5, conditions: [] });
    ctx.report.changed(where, 'It had no usable actions; it attacks.');
  }
  return {
    id,
    name,
    stats,
    ...(image ? { image } : {}),
    exp: Math.max(0, asInt(e['exp'])),
    gold: Math.max(0, asInt(e['gold'])),
    drops,
    actions,
    modifiers: traitModifiers(e['traits'], ctx, where, true).modifiers,
  };
}

function enemyConditions(
  act: JsonRecord,
  ctx: DatabaseContext,
  dropped: Set<string>,
): EnemyCondition[] | null {
  const type = asInt(act['conditionType']);
  const p1 = num(act['conditionParam1']);
  const p2 = num(act['conditionParam2']);
  switch (type) {
    case 0:
      return [];
    case 1:
      return [
        { type: 'turn', from: Math.max(1, Math.round(p1)), every: Math.max(0, Math.round(p2)) },
      ];
    case 2: {
      const conditions: EnemyCondition[] = [];
      if (p1 > 0)
        conditions.push({
          type: 'hp',
          compare: 'atLeast',
          percent: clamp(Math.round(p1 * 100), 1, 100),
        });
      if (p2 < 1)
        conditions.push({
          type: 'hp',
          compare: 'below',
          percent: clamp(Math.round(p2 * 100) + 1, 1, 100),
        });
      return conditions;
    }
    case 4: {
      const state = ctx.db.states.id(Math.round(p1));
      if (state) return [{ type: 'state', state, has: true }];
      dropped.add('a missing state');
      return [];
    }
    default:
      dropped.add(['', '', '', 'MP', '', 'party level', 'a switch'][type] ?? `condition ${type}`);
      return [];
  }
}

function importTroop(id: string, name: string, t: JsonRecord, ctx: DatabaseContext): TroopEntry[] {
  const where = `Troops › ${name}`;
  const enemies: string[] = [];
  // Where each stands: MZ's x, y are the enemy's feet on its screen, which becomes the project's.
  const places: { x: number; y: number }[] = [];
  let hidden = false;
  for (const raw of asArray(t['members'])) {
    const m = asRecord(raw);
    const enemy = ctx.db.enemies.id(asInt(m['enemyId']));
    if (!enemy) continue;
    if (m['hidden'] === true) hidden = true;
    enemies.push(enemy);
    places.push({ x: asInt(m['x'], -1), y: asInt(m['y'], -1) });
  }
  const kept = places.slice(0, 8);
  const placed = kept.length > 0 && kept.every((p) => p.x >= 0 && p.y >= 0);
  if (hidden)
    ctx.report.changed(
      where,
      'Some enemies appeared partway through; now all appear at the start.',
    );
  if (enemies.length > 8)
    ctx.report.changed(where, `It had ${enemies.length} enemies; FreeQuest troops hold 8.`);
  if (enemies.length === 0) {
    ctx.report.note(where, 'It has no enemies, so it was left out.');
    return [];
  }
  return [{ id, name, enemies: enemies.slice(0, 8), ...(placed ? { places: kept } : {}) }];
}

// --- System -----------------------------------------------------------------

/** system.json from the type lists and the attack and guard skills. */
export function systemData(
  types: SystemTypes,
  imported: ImportedDatabase,
  keep: Pick<SystemData, 'audio' | 'iconset' | 'balloons' | 'titleScreen' | 'battleBackground'>,
): SystemData {
  return {
    formatVersion: DATABASE_FORMAT_VERSION,
    ...types.lists(),
    ...(imported.attackSkill ? { attackSkill: imported.attackSkill } : {}),
    ...(imported.guardSkill ? { guardSkill: imported.guardSkill } : {}),
    ...(keep.audio ? { audio: keep.audio } : {}),
    ...(keep.iconset ? { iconset: keep.iconset } : {}),
    ...(keep.balloons ? { balloons: keep.balloons } : {}),
    ...(keep.titleScreen ? { titleScreen: keep.titleScreen } : {}),
    ...(keep.battleBackground ? { battleBackground: keep.battleBackground } : {}),
  };
}

export function entriesFile<T>(entries: readonly T[]) {
  return { formatVersion: DATABASE_FORMAT_VERSION, entries };
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
