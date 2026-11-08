import type { ItemEntry, SkillEntry } from '@freequest/schema';
import type { Actor } from './actor.js';
import type { Battler } from './battler.js';
import type { DatabaseIndex } from './database.js';
import {
  type TargetResult,
  type UseContext,
  itemProblem,
  resolveTargets,
  skillProblem,
  useItem,
  useSkill,
} from './effects.js';
import { type Drop, type Enemy, createEnemies } from './enemy.js';
import type { GameState } from './game-state.js';
import type { Party } from './party.js';

/** At most this many party members fight; the rest wait in reserve. */
export const MAX_BATTLE_MEMBERS = 4;
/** Base escape chance factor: chance = ESCAPE_BASE × party agility / enemy agility + bonus. */
const ESCAPE_BASE = 0.5;
/** Each failed escape attempt makes the next one this much likelier. */
const ESCAPE_BONUS_PER_FAILURE = 0.1;

/** What an actor (or enemy) does this turn. Attack and Guard are skills too. */
export type BattleAction =
  | { readonly kind: 'skill'; readonly skill: string; readonly target?: Battler }
  | { readonly kind: 'item'; readonly item: string; readonly target?: Battler };

export interface LevelUp {
  readonly actor: Actor;
  readonly level: number;
  readonly learnedSkills: readonly string[];
}

/** Everything that happens, in order, for the battle screen to show. */
export type BattleEvent =
  | { readonly type: 'turnStart'; readonly turn: number }
  | { readonly type: 'action'; readonly user: Battler; readonly name: string }
  | {
      readonly type: 'actionFailed';
      readonly user: Battler;
      readonly name: string;
      readonly reason: string;
    }
  | { readonly type: 'cannotAct'; readonly user: Battler; readonly state: string }
  | { readonly type: 'confused'; readonly user: Battler }
  | { readonly type: 'hit'; readonly user: Battler; readonly result: TargetResult }
  | { readonly type: 'regen'; readonly battler: Battler; readonly amount: number }
  | { readonly type: 'stateExpired'; readonly battler: Battler; readonly state: string }
  | { readonly type: 'escape'; readonly success: boolean }
  | {
      readonly type: 'victory';
      readonly exp: number;
      readonly gold: number;
      readonly drops: readonly Drop[];
      readonly levelUps: readonly LevelUp[];
    }
  | { readonly type: 'defeat' };

/** `input`: waiting for the player's commands. The others are final. */
export type BattlePhase = 'input' | 'won' | 'escaped' | 'lost';

export interface BattleOptions {
  readonly db: DatabaseIndex;
  readonly party: Party;
  /** Troop id to fight. */
  readonly troop: string;
  /** Variables for formulas. */
  readonly state: GameState;
  readonly canEscape: boolean;
  /** Uniform random in [0, 1). Inject a fixed one in tests. */
  readonly random?: () => number;
}

interface PlannedAction {
  readonly user: Battler;
  readonly action: BattleAction | null;
  readonly speed: number;
}

/**
 * A turn-based battle between the party's front members and a troop.
 * Each round: the player chooses actions for every member that can be
 * commanded, then `runTurn` resolves everyone's actions in speed order and
 * returns what happened as a list of events.
 */
export class Battle {
  readonly actors: readonly Actor[];
  readonly enemies: readonly Enemy[];
  readonly canEscape: boolean;
  private readonly db: DatabaseIndex;
  private readonly party: Party;
  private readonly random: () => number;
  private readonly ctx: UseContext;
  private readonly chosen = new Map<Actor, BattleAction>();
  private currentPhase: BattlePhase = 'input';
  private turnCount = 0;
  private failedEscapes = 0;

  constructor(options: BattleOptions) {
    this.db = options.db;
    this.party = options.party;
    this.random = options.random ?? Math.random;
    this.ctx = { state: options.state, random: this.random };
    this.canEscape = options.canEscape;
    this.actors = options.party.members.slice(0, MAX_BATTLE_MEMBERS);
    this.enemies = createEnemies(this.db, this.db.troops.get(options.troop).enemies);
    if (this.actors.length === 0) throw new Error('cannot start a battle with an empty party');
    // A party that is already down loses at once.
    if (this.actors.every((a) => a.isKnockedOut)) this.currentPhase = 'lost';
  }

  get phase(): BattlePhase {
    return this.currentPhase;
  }

  get turn(): number {
    return this.turnCount;
  }

  /** How many of an item the party carries (for the item menu). */
  itemCount(itemId: string): number {
    return this.party.count('item', itemId);
  }

  /** Living enemies, for target lists. */
  get livingEnemies(): Enemy[] {
    return this.enemies.filter((e) => !e.isKnockedOut);
  }

  /** Actors the player chooses actions for this turn, in party order. */
  actorsToCommand(): Actor[] {
    return this.actors.filter((a) => a.canAct && !this.isConfused(a));
  }

  /** Why an action isn't allowed for an actor right now, or null if it is. */
  actionProblem(actor: Actor, action: BattleAction): string | null {
    if (action.kind === 'skill') {
      return skillProblem(actor, this.db.skills.get(action.skill), 'battle');
    }
    return itemProblem(this.party, this.db.items.get(action.item), 'battle');
  }

  /** Choose an actor's action for this turn. Throws if not allowed. */
  setAction(actor: Actor, action: BattleAction): void {
    if (this.currentPhase !== 'input') throw new Error('the battle is over');
    if (!this.actorsToCommand().includes(actor))
      throw new Error(`${actor.name} can't be commanded`);
    const problem = this.actionProblem(actor, action);
    if (problem) throw new Error(problem);
    this.chosen.set(actor, action);
  }

  /** The action chosen for an actor this turn, if any. */
  actionOf(actor: Actor): BattleAction | undefined {
    return this.chosen.get(actor);
  }

  clearAction(actor: Actor): void {
    this.chosen.delete(actor);
  }

  /** Resolve a full turn with the chosen actions. Every commandable actor needs one. */
  runTurn(): BattleEvent[] {
    if (this.currentPhase !== 'input') throw new Error('the battle is over');
    const missing = this.actorsToCommand().filter((a) => !this.chosen.has(a));
    if (missing.length > 0) {
      throw new Error(`no action chosen for ${missing.map((a) => a.name).join(', ')}`);
    }
    const plans: PlannedAction[] = [
      ...this.actors.map((a) => this.plan(a, this.chosen.get(a) ?? null)),
      ...this.enemies.map((e) => this.plan(e, this.enemyAction(e))),
    ];
    return this.resolveTurn(plans);
  }

  /**
   * Try to run away instead of fighting this turn. On failure the enemies
   * still act (the party loses its turn). Throws if escape isn't allowed.
   */
  tryEscape(): BattleEvent[] {
    if (this.currentPhase !== 'input') throw new Error('the battle is over');
    if (!this.canEscape) throw new Error('there is no escaping this battle');
    const average = (list: readonly Battler[]) =>
      list.reduce((sum, b) => sum + b.stat('agility'), 0) / Math.max(1, list.length);
    const ratio =
      average(this.actors.filter((a) => !a.isKnockedOut)) /
      Math.max(1, average(this.livingEnemies));
    const chance = ESCAPE_BASE * ratio + ESCAPE_BONUS_PER_FAILURE * this.failedEscapes;
    if (this.random() < chance) {
      this.finish('escaped');
      return [{ type: 'escape', success: true }];
    }
    this.failedEscapes++;
    const plans = this.enemies.map((e) => this.plan(e, this.enemyAction(e)));
    return [{ type: 'escape', success: false }, ...this.resolveTurn(plans)];
  }

  // Turn resolution ---------------------------------------------------------

  private isConfused(battler: Battler): boolean {
    return battler.states.some((s) => this.db.states.get(s.id).restriction === 'confused');
  }

  /** Speed: agility plus a random bonus of up to a quarter of it. Guard goes first. */
  private plan(user: Battler, action: BattleAction | null): PlannedAction {
    const agility = user.stat('agility');
    let speed = agility + this.random() * (agility / 4 + 1);
    if (action?.kind === 'skill' && action.skill === this.db.system.guardSkill) speed += 1e6;
    return { user, action, speed };
  }

  private enemyAction(enemy: Enemy): BattleAction | null {
    const skill = enemy.chooseAction(this.random);
    return skill === null ? null : { kind: 'skill', skill };
  }

  private resolveTurn(plans: PlannedAction[]): BattleEvent[] {
    this.turnCount++;
    const events: BattleEvent[] = [{ type: 'turnStart', turn: this.turnCount }];
    // Faster first; on ties the party goes first.
    plans.sort(
      (x, y) => y.speed - x.speed || Number(this.isEnemy(x.user)) - Number(this.isEnemy(y.user)),
    );

    for (const plan of plans) {
      if (this.checkEnd(events)) return events;
      this.act(plan, events);
    }
    if (this.checkEnd(events)) return events;

    // End of turn: regeneration/poison (can knock out in battle), then countdowns.
    for (const battler of [...this.actors, ...this.enemies]) {
      if (battler.isKnockedOut) continue;
      const amount = battler.applyRegen();
      if (amount !== 0) events.push({ type: 'regen', battler, amount });
      for (const state of battler.tickTurn()) events.push({ type: 'stateExpired', battler, state });
    }
    this.checkEnd(events);
    this.chosen.clear();
    return events;
  }

  private isEnemy(battler: Battler): boolean {
    return (this.enemies as readonly Battler[]).includes(battler);
  }

  private act({ user, action }: PlannedAction, events: BattleEvent[]): void {
    if (user.isKnockedOut) return;
    if (!user.canAct) {
      const blocking = user.states.find(
        (s) => this.db.states.get(s.id).restriction === 'cannotAct',
      );
      if (blocking) events.push({ type: 'cannotAct', user, state: blocking.id });
      return;
    }
    if (this.isConfused(user)) {
      events.push({ type: 'confused', user });
      this.actConfused(user, events);
      return;
    }
    if (!action) return;

    const allies: readonly Battler[] = this.isEnemy(user) ? this.enemies : this.actors;
    const foes: readonly Battler[] = this.isEnemy(user) ? this.actors : this.enemies;
    const usable: SkillEntry | ItemEntry =
      action.kind === 'skill' ? this.db.skills.get(action.skill) : this.db.items.get(action.item);
    // Enemies (and actors without a chosen target) pick a random valid target.
    const chosen = action.target ?? this.randomPick(this.isEnemy(user) ? foes : []);
    const targets = resolveTargets(usable.target, user, allies, foes, this.random, chosen);

    events.push({ type: 'action', user, name: usable.name });
    let results: TargetResult[];
    try {
      results =
        action.kind === 'skill'
          ? useSkill(user, usable as SkillEntry, targets, 'battle', this.ctx)
          : useItem(this.party, user, usable as ItemEntry, targets, 'battle', this.ctx);
    } catch (error) {
      // E.g. MP drained, or the last potion was used earlier this turn.
      const reason =
        error instanceof Error ? error.message.replace(/^cannot use [^:]+: /, '') : 'failed';
      events.pop();
      events.push({ type: 'actionFailed', user, name: usable.name, reason });
      return;
    }
    for (const result of results) events.push({ type: 'hit', user, result });
  }

  /** A confused battler attacks someone at random, friend or foe. */
  private actConfused(user: Battler, events: BattleEvent[]): void {
    const attackId = this.db.system.attackSkill;
    const target = this.randomPick(
      [...this.actors, ...this.enemies].filter((b) => !b.isKnockedOut && b !== user),
    );
    if (!attackId || !target) return;
    const attack = this.db.skills.get(attackId);
    events.push({ type: 'action', user, name: attack.name });
    for (const result of useSkill(user, attack, [target], 'battle', this.ctx)) {
      events.push({ type: 'hit', user, result });
    }
  }

  /** A random standing battler from the list, or undefined if none. */
  private randomPick(list: readonly Battler[]): Battler | undefined {
    const living = list.filter((b) => !b.isKnockedOut);
    return living[Math.floor(this.random() * living.length)];
  }

  /** Detect victory or defeat; on victory hand out rewards. Returns true if the battle ended. */
  private checkEnd(events: BattleEvent[]): boolean {
    if (this.currentPhase !== 'input') return true;
    if (this.enemies.every((e) => e.isKnockedOut)) {
      events.push(this.win());
      return true;
    }
    if (this.actors.every((a) => a.isKnockedOut)) {
      this.finish('lost');
      events.push({ type: 'defeat' });
      return true;
    }
    return false;
  }

  /** Exp goes in full to every standing actor; gold and drops to the party. */
  private win(): BattleEvent {
    const exp = this.enemies.reduce((sum, e) => sum + e.exp, 0);
    const gold = this.enemies.reduce((sum, e) => sum + e.gold, 0);
    const drops = this.enemies.flatMap((e) => e.rollDrops(this.random));
    const levelUps: LevelUp[] = [];
    for (const actor of this.actors) {
      if (actor.isKnockedOut) continue;
      const result = actor.gainExp(exp);
      if (result.levelsGained > 0) {
        levelUps.push({ actor, level: actor.level, learnedSkills: result.learnedSkills });
      }
    }
    this.party.gainGold(gold);
    for (const drop of drops) this.party.gain(drop.kind, drop.id, 1);
    this.finish('won');
    return { type: 'victory', exp, gold, drops, levelUps };
  }

  private finish(phase: Exclude<BattlePhase, 'input'>): void {
    this.currentPhase = phase;
    this.chosen.clear();
    for (const actor of this.actors) actor.onBattleEnd();
  }
}
