import {
  ATTACK_ELEMENT,
  type Effect,
  type ItemEntry,
  type SkillEntry,
  type TargetScope,
} from '@freequest/schema';
import { Actor } from './actor.js';
import type { Battler } from './battler.js';
import { type FormulaContext, evaluateFormula } from './formula.js';
import type { GameState } from './game-state.js';
import type { Party } from './party.js';

/** Something usable on targets: a skill or an item. */
export type Usable = SkillEntry | ItemEntry;

export const CRITICAL_CHANCE = 0.05;
export const CRITICAL_MULTIPLIER = 3;

export interface UseContext {
  /** Variables for formulas (`v.<id>`). */
  readonly state: GameState;
  /** Uniform random number in [0, 1). Inject a fixed one in tests. */
  readonly random: () => number;
}

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
    };
    if (ctx.random() >= usable.successRate) return { ...result, missed: true };

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
          if (effect.critical && ctx.random() < CRITICAL_CHANCE) {
            amount *= CRITICAL_MULTIPLIER;
            result.critical = true;
          }
          const damage = Math.max(0, Math.round(amount));
          if (effect.pool === 'hp') {
            const before = target.hp;
            const wasKnockedOut = target.isKnockedOut;
            target.setHp(before - damage);
            result.hpDamage += before - target.hp;
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
  return applyUsable(skill, user, targets, ctx);
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
  return applyUsable(item, user, targets, ctx);
}
