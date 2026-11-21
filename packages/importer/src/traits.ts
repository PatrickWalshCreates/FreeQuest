// MZ "traits" ({ code, dataId, value }) on classes, actors, equipment, states
// and enemies become FreeQuest modifiers where FreeQuest has the same idea.
// Everything else is listed in the report, once per entry.
import type { Modifier, StatKey } from '@freequest/schema';
import { asArray, asInt, asRecord } from './json.js';
import type { MzDatabase } from './mz-lists.js';
import type { ImportReport } from './report.js';
import type { SystemTypes } from './system-types.js';

/** MZ's stat order (params[0..7]). */
export const PARAM_STATS: readonly StatKey[] = [
  'maxHp',
  'maxMp',
  'attack',
  'defense',
  'magicAttack',
  'magicDefense',
  'agility',
  'luck',
];

/** FreeQuest's base chances, which MZ gives battlers as traits instead. */
const BASE_RATES = { hitRate: 0.95, evasionRate: 0.05, criticalRate: 0.04 } as const;
type RateType = keyof typeof BASE_RATES;

const EX_PARAMS: Readonly<Record<number, RateType | 'hpRegen' | string>> = {
  0: 'hitRate',
  1: 'evasionRate',
  2: 'criticalRate',
  3: 'critical evasion',
  4: 'magicEvasionRate',
  5: 'reflectRate',
  6: 'counterRate',
  7: 'hpRegen',
  8: 'MP regeneration',
  9: 'TP regeneration',
};

const SP_PARAMS: Readonly<Record<number, string>> = {
  0: 'target rate',
  1: 'guard effect',
  2: 'recovery effect',
  3: 'pharmacology',
  4: 'MP cost rate',
  5: 'TP charge rate',
  6: 'physical damage rate',
  7: 'magical damage rate',
  8: 'floor damage rate',
  9: 'experience rate',
};

const OTHER: Readonly<Record<number, string>> = {
  12: 'debuff rates',
  32: 'attack states',
  33: 'attack speed',
  34: 'extra attacks',
  35: 'a different attack skill',
  42: 'sealed skill types',
  44: 'sealed skills',
  53: 'locked equipment',
  54: 'sealed equipment',
  55: 'dual wield',
  63: 'a collapse effect',
};

const PARTY_ABILITIES: Readonly<
  Record<number, 'fewerEncounters' | 'noEncounters' | 'doubleGold' | 'doubleDrops'>
> = { 0: 'fewerEncounters', 1: 'noEncounters', 4: 'doubleGold', 5: 'doubleDrops' };

export interface TraitContext {
  readonly db: MzDatabase;
  readonly types: SystemTypes;
  readonly report: ImportReport;
}

export interface TraitResult {
  readonly modifiers: Modifier[];
  /** Skills the traits add (MZ "add skill"), by id. */
  readonly skills: string[];
}

/**
 * Turn an entry's traits into modifiers.
 * @param base Whether this entry carries a battler's base chances (classes and
 *   enemies do in MZ); then FreeQuest's own base is taken off.
 */
export function traitModifiers(
  traits: unknown,
  ctx: TraitContext,
  where: string,
  base: boolean,
): TraitResult {
  const modifiers: Modifier[] = [];
  const skills: string[] = [];
  const left = new Set<string>();
  const rates: Partial<Record<RateType, number>> = {};
  let regen = 0;
  const physical: number[] = [];
  const magical: number[] = [];

  for (const raw of asArray(traits)) {
    const t = asRecord(raw);
    const code = asInt(t['code']);
    const data = asInt(t['dataId']);
    const value = typeof t['value'] === 'number' ? t['value'] : 0;
    switch (code) {
      case 11: {
        const element = ctx.types.elements.id(data);
        modifiers.push({ type: 'elementRate', element, value: Math.max(0, value) });
        break;
      }
      case 13:
      case 14: {
        const state = ctx.db.states.id(data);
        if (state)
          modifiers.push({ type: 'stateRate', state, value: code === 14 ? 0 : Math.max(0, value) });
        else left.add(`a rate for missing state ${data}`);
        break;
      }
      case 21: {
        const stat = PARAM_STATS[data];
        if (stat) modifiers.push({ type: 'statRate', stat, value: Math.max(0, value) });
        break;
      }
      case 22: {
        const kind = EX_PARAMS[data];
        if (kind === 'hitRate' || kind === 'evasionRate' || kind === 'criticalRate') {
          rates[kind] = (rates[kind] ?? 0) + value;
        } else if (kind === 'hpRegen') regen += value;
        else if (kind === 'counterRate' || kind === 'reflectRate' || kind === 'magicEvasionRate') {
          // Chances on their own (FreeQuest has no base for these): one modifier per trait.
          if (value > 0) modifiers.push({ type: kind, value: clamp(round(value), 0, 1) });
        } else if (value !== 0 && kind) left.add(kind);
        break;
      }
      case 23: {
        if (data === 6) physical.push(value);
        else if (data === 7) magical.push(value);
        else if (value !== 1 && SP_PARAMS[data]) left.add(SP_PARAMS[data]);
        break;
      }
      case 31:
        modifiers.push({ type: 'attackElement', element: ctx.types.elements.id(data) });
        break;
      case 41:
        break; // FreeQuest actors can use every skill type
      case 43: {
        const skill = ctx.db.skills.id(data);
        if (skill) skills.push(skill);
        break;
      }
      case 51:
        modifiers.push({ type: 'equipType', equipmentType: ctx.types.weaponTypes.id(data) });
        break;
      case 52:
        modifiers.push({ type: 'equipType', equipmentType: ctx.types.armorTypes.id(data) });
        break;
      case 61:
        // Action times +: a chance of acting once more each turn.
        if (value > 0) modifiers.push({ type: 'extraActions', value: clamp(round(value), 0, 1) });
        break;
      case 64: {
        // Party abilities: 0 encounters half, 1 none, 2 cancel surprise, 3 raise preemptive,
        // 4 gold double, 5 drop item double.
        const ability = PARTY_ABILITIES[data];
        if (ability) modifiers.push({ type: 'partyAbility', ability });
        else
          left.add(
            data === 2
              ? 'no surprise attacks'
              : data === 3
                ? 'more first strikes'
                : 'a party ability',
          );
        break;
      }
      case 62:
        // Special flags: 0 auto battle, 1 guard, 2 substitute, 3 preserve TP.
        if (data === 1) modifiers.push({ type: 'damageTaken', value: 0.5 });
        else
          left.add(['auto battle', 'guard', 'substitute', 'keeping TP'][data] ?? 'a special flag');
        break;
      default:
        left.add(OTHER[code] ?? `trait ${code}`);
    }
  }

  for (const kind of Object.keys(BASE_RATES) as RateType[]) {
    const sum = rates[kind];
    if (sum === undefined) continue;
    const value = round(base ? sum - BASE_RATES[kind] : sum);
    if (value !== 0) modifiers.push({ type: kind, value: clamp(value, -1, 1) });
  }
  if (regen !== 0) modifiers.push({ type: 'hpRegen', value: clamp(round(regen), -1, 1) });

  // FreeQuest has one "damage taken" rate for all HP damage: the physical one is kept.
  const p = round(physical.reduce((x, y) => x * y, 1));
  const m = round(magical.reduce((x, y) => x * y, 1));
  if (p !== 1) modifiers.push({ type: 'damageTaken', value: Math.max(0, p) });
  if (m !== p) {
    ctx.report.changed(
      where,
      `Magical damage taken ×${m} differs from physical ×${p}; FreeQuest has one rate for both, the physical one was kept.`,
    );
  }
  if (left.size > 0) {
    ctx.report.missing(
      where,
      `Traits FreeQuest doesn't have: ${[...left].join(', ')}.`,
      [...left].map((name) => ({ name: `Trait: ${name}`, count: 1 })),
    );
  }
  return { modifiers, skills };
}

/** Flat stat bonuses (equipment's params) as statFlat modifiers. */
export function flatStats(params: unknown): Modifier[] {
  const list = asArray(params);
  return PARAM_STATS.flatMap((stat, i) => {
    const value = asInt(list[i]);
    return value === 0 ? [] : [{ type: 'statFlat', stat, value } as const];
  });
}

const round = (n: number) => Math.round(n * 10000) / 10000;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
