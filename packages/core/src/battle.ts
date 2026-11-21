import type { TroopPlace } from './battle-layout.js';
import type { Command, ItemEntry, SkillEntry, StatKey, TroopEvent } from '@freequest/schema';
import type { Actor } from './actor.js';
import type { Battler } from './battler.js';
import type { DatabaseIndex } from './database.js';
import {
  applyUsable,
  type TargetResult,
  type UseContext,
  commonEventsOf,
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
  /** `battler` answers `target`'s physical hit with an attack instead of taking it. */
  | { readonly type: 'counter'; readonly battler: Battler; readonly target: Battler }
  /** `battler` sends `user`'s magic back at them. */
  | { readonly type: 'reflect'; readonly battler: Battler; readonly user: Battler }
  | {
      readonly type: 'hit';
      readonly user: Battler;
      readonly result: TargetResult;
      /** The skill's or item's animation, played on the target (null: none). */
      readonly animation: string | null;
    }
  | { readonly type: 'regen'; readonly battler: Battler; readonly amount: number }
  | { readonly type: 'stateExpired'; readonly battler: Battler; readonly state: string }
  /** A buff or debuff wore off at the end of a turn. */
  | { readonly type: 'buffExpired'; readonly battler: Battler; readonly stat: StatKey }
  /** A skill's or item's common event, to run now (in the battle). */
  | { readonly type: 'commonEvent'; readonly common: string }
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
  private readonly state: GameState;
  private readonly troopEvents: readonly TroopEvent[];
  /** The troop's places for its enemies (see `enemyPlaces`), if it has them. */
  readonly places: readonly TroopPlace[] | undefined;
  /** Troop pages that ran: once a battle (by index), and in which turn they last ran. */
  private readonly ranInBattle = new Set<number>();
  private readonly ranInTurn = new Map<number, number>();
  private failedEscapes = 0;

  constructor(options: BattleOptions) {
    this.db = options.db;
    this.party = options.party;
    this.random = options.random ?? Math.random;
    this.ctx = { state: options.state, random: this.random, inBattle: true };
    this.state = options.state;
    this.troopEvents = this.db.troops.get(options.troop).events ?? [];
    this.places = this.db.troops.get(options.troop).places;
    this.canEscape = options.canEscape;
    this.actors = options.party.members.slice(0, MAX_BATTLE_MEMBERS);
    this.enemies = createEnemies(this.db, this.db.troops.get(options.troop).enemies);
    // Every battle starts without TP or buffs.
    for (const actor of options.party.members) actor.resetBattleState();
    if (this.actors.length === 0) throw new Error('cannot start a battle with an empty party');
    // A party that is already down loses at once.
    if (this.actors.every((a) => a.isKnockedOut)) this.currentPhase = 'lost';
  }

  /** Whether this game uses TP at all (some skill or item costs, gains or gives it). */
  get usesTp(): boolean {
    const usables = [...this.db.skills.all, ...this.db.items.all];
    return usables.some(
      (u) =>
        ('tpCost' in u && (u.tpCost ?? 0) > 0) ||
        (u.tpGain ?? 0) > 0 ||
        u.effects.some((e) => e.type === 'gainTp'),
    );
  }

  get phase(): BattlePhase {
    return this.currentPhase;
  }

  get turn(): number {
    return this.turnCount;
  }

  /** Display name of a state, or null for ones not worth showing (knockout, unknown). */
  stateName(id: string): string | null {
    const entry = this.db.states.find(id);
    return entry && !entry.knockout ? entry.name : null;
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
    return this.resolveTurn(this.withExtraActions(plans));
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
    return [{ type: 'escape', success: false }, ...this.resolveTurn(this.withExtraActions(plans))];
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

  /**
   * Extra actions: each `extraActions` chance that rolls true adds another
   * action this turn: party members repeat their command, enemies choose again.
   */
  private withExtraActions(plans: PlannedAction[]): PlannedAction[] {
    const extras: PlannedAction[] = [];
    for (const { user, action } of plans) {
      for (const chance of user.extraActionChances()) {
        if (this.random() >= chance) continue;
        const again = this.isEnemy(user) ? this.enemyAction(user as Enemy) : action;
        if (again) extras.push(this.plan(user, again));
      }
    }
    return [...plans, ...extras];
  }

  private enemyAction(enemy: Enemy): BattleAction | null {
    // Actions are planned before the turn starts: this is the coming turn's number.
    const skill = enemy.chooseAction(this.random, this.turnCount + 1);
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
      for (const stat of battler.tickBuffs()) events.push({ type: 'buffExpired', battler, stat });
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
    // Foes may counter a physical hit (instead of taking it) or send magic back.
    const hit: Battler[] = [];
    const countering: Battler[] = [];
    const reflecting: Battler[] = [];
    for (const target of targets) {
      const foe = foes.includes(target) && !target.isKnockedOut;
      if (foe && usable.hitType === 'physical' && target.canAct) {
        if (this.random() < target.counterRate()) {
          countering.push(target);
          continue;
        }
      }
      if (foe && usable.hitType === 'magical' && this.random() < target.reflectRate()) {
        reflecting.push(target);
        continue;
      }
      hit.push(target);
    }
    let results: TargetResult[];
    try {
      results =
        action.kind === 'skill'
          ? useSkill(user, usable as SkillEntry, hit, 'battle', this.ctx)
          : useItem(this.party, user, usable as ItemEntry, hit, 'battle', this.ctx);
    } catch (error) {
      // E.g. MP drained, or the last potion was used earlier this turn.
      const reason =
        error instanceof Error ? error.message.replace(/^cannot use [^:]+: /, '') : 'failed';
      events.pop();
      events.push({ type: 'actionFailed', user, name: usable.name, reason });
      return;
    }
    const animation = usable.animation ?? null;
    for (const result of results) events.push({ type: 'hit', user, result, animation });
    for (const common of commonEventsOf(usable, results))
      events.push({ type: 'commonEvent', common });
    for (const battler of reflecting) {
      if (user.isKnockedOut) break;
      events.push({ type: 'reflect', battler, user });
      for (const result of applyUsable(usable, user, [user], this.ctx)) {
        events.push({ type: 'hit', user, result, animation });
      }
    }
    for (const battler of countering) {
      if (user.isKnockedOut || battler.isKnockedOut) break;
      const attackId = this.db.system.attackSkill;
      if (!attackId) break;
      const attack = this.db.skills.get(attackId);
      events.push({ type: 'counter', battler, target: user });
      for (const result of applyUsable(attack, battler, [user], this.ctx)) {
        events.push({ type: 'hit', user: battler, result, animation: attack.animation ?? null });
      }
    }
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
      events.push({ type: 'hit', user, result, animation: attack.animation ?? null });
    }
  }

  /** A random standing battler from the list, or undefined if none. */
  private randomPick(list: readonly Battler[]): Battler | undefined {
    const living = list.filter((b) => !b.isKnockedOut);
    return living[Math.floor(this.random() * living.length)];
  }

  /**
   * The troop's battle events due now: as the coming turn starts (`turnStart`,
   * also before the first turn) or as the turn just played ends (`turnEnd`).
   * Each page's span is honoured: once a battle, once a turn, or every time.
   */
  dueEvents(moment: 'turnStart' | 'turnEnd'): (readonly Command[])[] {
    if (this.currentPhase !== 'input') return [];
    const turn = moment === 'turnStart' ? this.turnCount + 1 : this.turnCount;
    if (turn < 1) return [];
    const due: (readonly Command[])[] = [];
    this.troopEvents.forEach((page, i) => {
      if ((page.conditions.turnEnd === true) !== (moment === 'turnEnd')) return;
      if (!this.holds(page, turn)) return;
      if (page.span === 'battle' && this.ranInBattle.has(i)) return;
      if (page.span === 'turn' && this.ranInTurn.get(i) === turn) return;
      this.ranInBattle.add(i);
      this.ranInTurn.set(i, turn);
      due.push(page.commands);
    });
    return due;
  }

  private holds(page: TroopEvent, turn: number): boolean {
    const c = page.conditions;
    const percent = (b: Battler) => (b.maxHp > 0 ? (b.hp * 100) / b.maxHp : 0);
    const checks: boolean[] = [];
    if (c.turn) {
      const { from, every } = c.turn;
      checks.push(every === 0 ? turn === from : turn >= from && (turn - from) % every === 0);
    }
    if (c.enemyHp) {
      const enemy = this.enemies[c.enemyHp.enemy];
      checks.push(!!enemy && !enemy.isKnockedOut && percent(enemy) <= c.enemyHp.below);
    }
    if (c.actorHp) {
      const actorHp = c.actorHp;
      const actor = this.actors.find((a) => a.id === actorHp.actor);
      checks.push(!!actor && percent(actor) <= actorHp.below);
    }
    if (c.switch !== undefined) checks.push(this.state.getSwitch(c.switch));
    // A page with no conditions never runs (as nothing says when).
    return checks.length > 0 && checks.every(Boolean);
  }

  /** After events changed things (HP, states): the battle's end, if it has come. */
  checkOutcome(): BattleEvent[] {
    if (this.currentPhase !== 'input') return [];
    const events: BattleEvent[] = [];
    this.checkEnd(events);
    return events;
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
    const gold =
      this.enemies.reduce((sum, e) => sum + e.gold, 0) *
      (this.party.hasAbility('doubleGold') ? 2 : 1);
    const dropRate = this.party.hasAbility('doubleDrops') ? 2 : 1;
    const drops = this.enemies.flatMap((e) => e.rollDrops(this.random, dropRate));
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
