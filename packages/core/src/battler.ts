import { type Modifier, STAT_KEYS, type StatKey, type StateEntry } from '@freequest/schema';
import type { DatabaseIndex } from './database.js';
import type { FormulaSubject } from './formula.js';

export const BASE_HIT_RATE = 0.95;
export const BASE_EVASION_RATE = 0.05;
export const BASE_CRITICAL_RATE = 0.04;

/** A state on a battler, with whatever countdown it needs to wear off. */
export interface StateInstance {
  readonly id: string;
  /** Battle turns left (states with turn-based removal). */
  turns?: number;
  /** Map steps left (states with step-based removal). */
  steps?: number;
}

/**
 * Shared logic of everything that fights: actors and enemies. Effective
 * values combine the battler's base values with every modifier that applies
 * to it (class, equipment, states, its own).
 *
 * Stat = max(0, round((base + flat bonuses) × product of rates)); max HP is at least 1.
 */
export abstract class Battler implements FormulaSubject {
  protected currentHp = 0;
  protected currentMp = 0;
  protected readonly stateList: StateInstance[] = [];

  constructor(protected readonly db: DatabaseIndex) {}

  abstract get name(): string;
  abstract get level(): number;
  /** Stat before modifiers. */
  protected abstract baseStat(stat: StatKey): number;
  /** Modifiers from the battler's own sources (class, equipment, enemy data...). */
  protected abstract ownModifiers(): readonly Modifier[];

  /** Every modifier that currently applies, including those from states. */
  modifiers(): Modifier[] {
    const fromStates = this.stateList.flatMap((s) => this.db.states.get(s.id).modifiers);
    return [...this.ownModifiers(), ...fromStates];
  }

  stat(stat: StatKey): number {
    let flat = 0;
    let rate = 1;
    for (const m of this.modifiers()) {
      if (m.type === 'statFlat' && m.stat === stat) flat += m.value;
      else if (m.type === 'statRate' && m.stat === stat) rate *= m.value;
    }
    const value = Math.max(0, Math.round((this.baseStat(stat) + flat) * rate));
    return stat === 'maxHp' ? Math.max(1, value) : value;
  }

  /** All eight stats at once. */
  stats(): Record<StatKey, number> {
    return Object.fromEntries(STAT_KEYS.map((s) => [s, this.stat(s)])) as Record<StatKey, number>;
  }

  get maxHp(): number {
    return this.stat('maxHp');
  }

  get maxMp(): number {
    return this.stat('maxMp');
  }

  get hp(): number {
    return this.currentHp;
  }

  get mp(): number {
    return this.currentMp;
  }

  /** Set HP (clamped). Reaching 0 adds the knockout state; a knocked-out battler stays at 0. */
  setHp(value: number): void {
    if (this.isKnockedOut) {
      this.currentHp = 0;
      return;
    }
    this.currentHp = clampInt(value, 0, this.maxHp);
    if (this.currentHp === 0 && this.db.knockoutState) this.addState(this.db.knockoutState.id);
  }

  setMp(value: number): void {
    this.currentMp = clampInt(value, 0, this.maxMp);
  }

  /** Restore HP and MP to full and clear all states (e.g. an inn). */
  recoverAll(): void {
    this.stateList.length = 0;
    this.currentHp = this.maxHp;
    this.currentMp = this.maxMp;
  }

  /** Re-clamp HP/MP after max values may have changed (equipment, states, level). */
  protected clampPools(): void {
    this.currentHp = Math.min(this.currentHp, this.maxHp);
    this.currentMp = Math.min(this.currentMp, this.maxMp);
  }

  get states(): readonly StateInstance[] {
    return this.stateList;
  }

  hasState(id: string): boolean {
    return this.stateList.some((s) => s.id === id);
  }

  /** True while the battler has a state flagged as knockout. */
  get isKnockedOut(): boolean {
    return this.stateList.some((s) => this.db.states.get(s.id).knockout);
  }

  /**
   * Add a state (no chance roll; see effects for that). Re-adding refreshes
   * its countdowns. Knockout clears every other state and zeroes HP.
   */
  addState(id: string, random: () => number = Math.random): void {
    const entry = this.db.states.get(id);
    if (entry.knockout) {
      this.stateList.length = 0;
      this.currentHp = 0;
    }
    const instance: StateInstance = { id };
    const { turns, steps } = entry.removal;
    if (turns) instance.turns = turns.min + Math.floor(random() * (turns.max - turns.min + 1));
    if (steps) instance.steps = steps;
    const existing = this.stateList.findIndex((s) => s.id === id);
    if (existing === -1) this.stateList.push(instance);
    else this.stateList[existing] = instance;
    this.stateList.sort(
      (x, y) => this.db.states.get(y.id).priority - this.db.states.get(x.id).priority,
    );
    this.clampPools();
  }

  /** Remove a state. Removing knockout revives the battler with at least 1 HP. */
  removeState(id: string): void {
    const index = this.stateList.findIndex((s) => s.id === id);
    if (index === -1) return;
    this.stateList.splice(index, 1);
    if (this.db.states.get(id).knockout) this.currentHp = Math.max(this.currentHp, 1);
    this.clampPools();
  }

  stateEntry(id: string): StateEntry {
    return this.db.states.get(id);
  }

  /** False when knocked out or under a state that prevents acting. */
  get canAct(): boolean {
    return (
      !this.isKnockedOut &&
      !this.stateList.some((s) => this.stateEntry(s.id).restriction === 'cannotAct')
    );
  }

  /** End of a battle turn: count down turn-limited states. Returns the ids removed. */
  tickTurn(): string[] {
    return this.countDown('turns');
  }

  /** The player took a step on the map: count down step-limited states. Returns the ids removed. */
  tickStep(): string[] {
    return this.countDown('steps');
  }

  private countDown(key: 'turns' | 'steps'): string[] {
    const removed: string[] = [];
    for (const state of [...this.stateList]) {
      const left = state[key];
      if (left === undefined) continue;
      if (left <= 1) {
        this.removeState(state.id);
        removed.push(state.id);
      } else {
        state[key] = left - 1;
      }
    }
    return removed;
  }

  /**
   * Apply HP regeneration / poison once. `minHp` keeps slip damage from
   * knocking out (1 on the map). Returns the HP change.
   */
  applyRegen(minHp = 0): number {
    if (this.isKnockedOut) return 0;
    const amount = Math.round(this.maxHp * this.hpRegenRate());
    if (amount === 0) return 0;
    const before = this.currentHp;
    const floor = Math.min(before, minHp);
    this.setHp(Math.max(before + amount, floor));
    return this.currentHp - before;
  }

  /** Remove states that end with the battle. Returns the ids removed. */
  onBattleEnd(): string[] {
    const ending = this.stateList.filter((s) => this.stateEntry(s.id).removal.battleEnd);
    for (const s of ending) this.removeState(s.id);
    return ending.map((s) => s.id);
  }

  /** Damage taken multiplier for an element (product of elementRate modifiers). */
  elementRate(element: string): number {
    return this.modifiers().reduce(
      (rate, m) => (m.type === 'elementRate' && m.element === element ? rate * m.value : rate),
      1,
    );
  }

  /** Chance multiplier for receiving a state (0 = immune). */
  stateRate(state: string): number {
    return this.modifiers().reduce(
      (rate, m) => (m.type === 'stateRate' && m.state === state ? rate * m.value : rate),
      1,
    );
  }

  /** Elements of this battler's normal attack. */
  attackElements(): string[] {
    return [
      ...new Set(this.modifiers().flatMap((m) => (m.type === 'attackElement' ? [m.element] : []))),
    ];
  }

  /** Net fraction of max HP regained per turn (negative = poison). */
  hpRegenRate(): number {
    return this.modifiers().reduce((sum, m) => (m.type === 'hpRegen' ? sum + m.value : sum), 0);
  }

  private sumOf(type: 'hitRate' | 'evasionRate' | 'criticalRate'): number {
    return this.modifiers().reduce((sum, m) => (m.type === type ? sum + m.value : sum), 0);
  }

  /** Chance multiplier for physical hits to land (base BASE_HIT_RATE). */
  hitRate(): number {
    return BASE_HIT_RATE + this.sumOf('hitRate');
  }

  /** Chance to dodge physical hits (base BASE_EVASION_RATE). */
  evasionRate(): number {
    return BASE_EVASION_RATE + this.sumOf('evasionRate');
  }

  /** Chance for a damage effect that can crit to do so (base BASE_CRITICAL_RATE). */
  criticalRate(): number {
    return BASE_CRITICAL_RATE + this.sumOf('criticalRate');
  }

  /** Multiplier on HP damage taken (product of damageTaken modifiers; guarding = 0.5). */
  damageTakenRate(): number {
    return this.modifiers().reduce(
      (rate, m) => (m.type === 'damageTaken' ? rate * m.value : rate),
      1,
    );
  }

  /** For formulas: a.<key> / b.<key>. */
  formulaValue(key: string): number {
    if (key === 'hp') return this.hp;
    if (key === 'mp') return this.mp;
    if (key === 'level') return this.level;
    return (STAT_KEYS as readonly string[]).includes(key) ? this.stat(key as StatKey) : 0;
  }
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max);
}
