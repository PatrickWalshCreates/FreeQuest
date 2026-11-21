import {
  ATTACK_ELEMENT,
  type Effect,
  type ItemEntry,
  type SkillEntry,
  type StatKey,
  type TargetScope,
} from '@freequest/schema';
import { Actor } from './actor.js';
import type { Battler } from './battler.js';
import { type FormulaContext, evaluateFormula } from './formula.js';
import type { GameState } from './game-state.js';
import type { Party } from './party.js';

/** Something usable on targets: a skill or an item. */
export type Usable = SkillEntry | ItemEntry;

export const CRITICAL_MULTIPLIER = 3;

export interface UseContext {
  /** Variables for formulas (`v.<id>`). */
  readonly state: GameState;
  /** Uniform random number in [0, 1). Inject a fixed one in tests. */
  readonly random: () => number;
  /** In a battle: HP damage charges TP, and uses give their TP. */
  readonly inBattle?: boolean;
}

/** TP gained by taking damage: this much for losing all of one's HP (in proportion). */
export const TP_FROM_DAMAGE = 50;

/** What happened to one target. Positive damage hurts; negative heals. */
export interface TargetResult {
  readonly target: Battler;
  readonly missed: boolean;
  readonly hpDamage: number;
  readonly mpDamage: number;
  readonly critical: boolean;
  readonly addedStates: readonly string[];
  readonly removedStates: readonly string[];
  readonly learnedSkills: readonly string[];
  /** Stats raised (1) or lowered (−1) a level. */
  readonly buffs: readonly { readonly stat: StatKey; readonly change: 1 | -1 }[];
  /** TP the target gained (or lost) from the effects. */
  readonly tpChange: number;
}

/** Whether a battler is a valid target for a scope (knocked-out allies only for `dead` scopes). */
export function canTarget(scope: TargetScope, battler: Battler): boolean {
  const wantsDead = 'dead' in scope && scope.dead === true;
  return battler.isKnockedOut === wantsDead;
}

/**
 * Concrete targets for a scope. `allies` are the user's side. `chosen` is the
 * picked target for "one" scopes (falls back to the first valid one).
 */
export function resolveTargets(
  scope: TargetScope,
  user: Battler,
  allies: readonly Battler[],
  enemies: readonly Battler[],
  random: () => number,
  chosen?: Battler,
): Battler[] {
  if (scope.side === 'none') return [];
  if (scope.side === 'user') return [user];
  const pool = (scope.side === 'ally' ? allies : enemies).filter((b) => canTarget(scope, b));
  if (scope.select === 'all') return pool;
  if (scope.select === 'random') {
    if (pool.length === 0) return [];
    return Array.from(
      { length: scope.count },
      () => pool[Math.floor(random() * pool.length)],
    ).filter((b): b is Battler => b !== undefined);
  }
  const target = chosen && pool.includes(chosen) ? chosen : pool[0];
  return target ? [target] : [];
}

/**
 * Chance that a use lands on a target: the success rate, for physical hits
 * also the user's hit rate minus the target's evasion, for magic minus the
 * target's magic evasion. Using something on yourself never misses.
 */
export function hitChance(usable: Usable, user: Battler, target: Battler): number {
  if (user === target) return 1;
  if (usable.hitType === 'magical') return usable.successRate - target.magicEvasionRate();
  if (usable.hitType !== 'physical') return usable.successRate;
  return usable.successRate * user.hitRate() - target.evasionRate();
}

/** Damage multiplier from elements: the explicit element, or the user's best attack element. */
function elementMultiplier(
  effect: Extract<Effect, { type: 'damage' }>,
  user: Battler,
  target: Battler,
): number {
  if (effect.element === undefined) return 1;
  if (effect.element !== ATTACK_ELEMENT) return target.elementRate(effect.element);
  const elements = user.attackElements();
  return elements.length === 0 ? 1 : Math.max(...elements.map((e) => target.elementRate(e)));
}

/**
 * Apply a skill's or item's effects to each target, in order. Does not pay
 * costs or check usability: see `useSkill` / `useItem`.
 */
export function applyUsable(
  usable: Usable,
  user: Battler,
  targets: readonly Battler[],
  ctx: UseContext,
): TargetResult[] {
  return targets.map((target) => {
    const result = {
      target,
      missed: false,
      hpDamage: 0,
      mpDamage: 0,
      critical: false,
      addedStates: [] as string[],
      removedStates: [] as string[],
      learnedSkills: [] as string[],
      buffs: [] as { stat: StatKey; change: 1 | -1 }[],
      tpChange: 0,
    };
    if (ctx.random() >= hitChance(usable, user, target)) return { ...result, missed: true };

    const formulaCtx: FormulaContext = {
      a: user,
      b: target,
      variable: (id) => ctx.state.getVariable(id),
      random: ctx.random,
    };
    for (const effect of usable.effects) {
      switch (effect.type) {
        case 'damage': {
          let amount =
            evaluateFormula(effect.formula, formulaCtx) * elementMultiplier(effect, user, target);
          amount *= 1 + (ctx.random() * 2 - 1) * effect.variance;
          if (effect.critical && ctx.random() < user.criticalRate()) {
            amount *= CRITICAL_MULTIPLIER;
            result.critical = true;
          }
          if (effect.pool === 'hp') amount *= target.damageTakenRate();
          const damage = Math.max(0, Math.round(amount));
          if (effect.pool === 'hp') {
            const before = target.hp;
            const wasKnockedOut = target.isKnockedOut;
            target.setHp(before - damage);
            result.hpDamage += before - target.hp;
            // Being hurt charges TP, in proportion to the share of HP lost.
            if (ctx.inBattle && before > target.hp && !target.isKnockedOut) {
              target.setTp(
                target.tp + Math.floor((TP_FROM_DAMAGE * (before - target.hp)) / target.maxHp),
              );
            }
            if (!wasKnockedOut && target.isKnockedOut) {
              const ko = target.states.find((s) => target.stateEntry(s.id).knockout);
              if (ko) result.addedStates.push(ko.id);
            } else if (damage > 0) {
              wakeOnDamage(target, ctx.random, result.removedStates);
            }
          } else {
            const before = target.mp;
            target.setMp(before - damage);
            result.mpDamage += before - target.mp;
          }
          break;
        }
        case 'recover': {
          const amount = Math.max(0, Math.round(evaluateFormula(effect.formula, formulaCtx)));
          if (effect.pool === 'hp') {
            const before = target.hp;
            target.setHp(before + amount);
            result.hpDamage -= target.hp - before;
          } else {
            const before = target.mp;
            target.setMp(before + amount);
            result.mpDamage -= target.mp - before;
          }
          break;
        }
        case 'addState':
          if (ctx.random() < effect.chance * target.stateRate(effect.state)) {
            target.addState(effect.state, ctx.random);
            result.addedStates.push(effect.state);
          }
          break;
        case 'removeState':
          if (target.hasState(effect.state)) {
            target.removeState(effect.state);
            result.removedStates.push(effect.state);
          }
          break;
        case 'buff': {
          const change = effect.direction === 'up' ? 1 : -1;
          target.addBuff(effect.stat, change, effect.turns);
          result.buffs.push({ stat: effect.stat, change });
          break;
        }
        case 'gainTp': {
          const before = target.tp;
          target.setTp(before + effect.amount);
          result.tpChange += target.tp - before;
          break;
        }
        case 'commonEvent':
          // Runs once the use is over (see `commonEventsOf`), not per target.
          break;
        case 'learnSkill':
          if (target instanceof Actor && !target.hasSkill(effect.skill)) {
            target.learnSkill(effect.skill);
            result.learnedSkills.push(effect.skill);
          }
          break;
      }
    }
    return result;
  });
}

/** States with a damage removal chance (e.g. sleep) may wear off when hit. */
function wakeOnDamage(target: Battler, random: () => number, removed: string[]): void {
  for (const state of [...target.states]) {
    const chance = target.stateEntry(state.id).removal.damageChance;
    if (chance !== undefined && random() < chance) {
      target.removeState(state.id);
      removed.push(state.id);
    }
  }
}

export type Situation = 'battle' | 'menu';

function occasionAllows(occasion: Usable['occasion'], situation: Situation): boolean {
  return occasion === 'always' || occasion === situation;
}

/** Why a skill can't be used right now, or null if it can. */
export function skillProblem(
  user: Battler,
  skill: SkillEntry,
  situation: Situation,
): string | null {
  if (!occasionAllows(skill.occasion, situation)) return `can't be used in the ${situation}`;
  if (user instanceof Actor && !user.hasSkill(skill.id)) return `${user.name} doesn't know it`;
  if (user.mp < skill.mpCost) return 'not enough MP';
  if ((skill.tpCost ?? 0) > user.tp) return 'not enough TP';
  if (!user.canAct) return `${user.name} can't act`;
  return null;
}

/** Why an item can't be used right now, or null if it can. */
export function itemProblem(party: Party, item: ItemEntry, situation: Situation): string | null {
  if (!occasionAllows(item.occasion, situation)) return `can't be used in the ${situation}`;
  if (party.count('item', item.id) < 1) return 'none left';
  return null;
}

/** Pay a skill's MP cost and apply it. Throws if it can't be used. */
export function useSkill(
  user: Battler,
  skill: SkillEntry,
  targets: readonly Battler[],
  situation: Situation,
  ctx: UseContext,
): TargetResult[] {
  const problem = skillProblem(user, skill, situation);
  if (problem) throw new Error(`cannot use ${skill.name}: ${problem}`);
  user.setMp(user.mp - skill.mpCost);
  user.setTp(user.tp - (skill.tpCost ?? 0));
  return applyRepeated(skill, user, targets, ctx);
}

/**
 * Apply a use as many times as it `repeats` (each time on the targets still
 * valid), then give the user its TP in battle.
 */
function applyRepeated(
  usable: Usable,
  user: Battler,
  targets: readonly Battler[],
  ctx: UseContext,
): TargetResult[] {
  const results: TargetResult[] = [];
  for (let i = 0; i < (usable.repeats ?? 1); i++) {
    const now = i === 0 ? targets : targets.filter((t) => canTarget(usable.target, t));
    if (now.length === 0) break;
    results.push(...applyUsable(usable, user, now, ctx));
  }
  if (ctx.inBattle && usable.tpGain) user.setTp(user.tp + usable.tpGain);
  return results;
}

/**
 * The common events a use runs once it's over: its commonEvent effects,
 * unless it missed every target.
 */
export function commonEventsOf(usable: Usable, results: readonly TargetResult[]): string[] {
  // Missing everyone means it didn't happen (a use with no targets still does).
  if (results.length > 0 && results.every((r) => r.missed)) return [];
  return usable.effects.flatMap((e) => (e.type === 'commonEvent' ? [e.common] : []));
}

/** Consume (if consumable) and apply an item. Throws if it can't be used. */
export function useItem(
  party: Party,
  user: Battler,
  item: ItemEntry,
  targets: readonly Battler[],
  situation: Situation,
  ctx: UseContext,
): TargetResult[] {
  const problem = itemProblem(party, item, situation);
  if (problem) throw new Error(`cannot use ${item.name}: ${problem}`);
  if (item.consumable) party.gain('item', item.id, -1);
  return applyRepeated(item, user, targets, ctx);
}
