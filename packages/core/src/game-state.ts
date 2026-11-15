import type {
  Command,
  CommandOf,
  CompareOp,
  Direction,
  IfCondition,
  InputAction,
  Manifest,
  Operand,
  VariableOp,
  VariableValue,
} from '@freequest/schema';
import type { Party } from './party.js';
import type { ScreenEffects } from './screen.js';
import type { MapScroll } from './scroll.js';

/** Event flags that are on: map id → event id → flag ids (as saves store them). */
export type FlagData = Record<string, Record<string, string[]>>;

/** Everything `GameState.toData()` gives and `loadData()` takes. */
export interface GameStateData {
  switches: Record<string, boolean>;
  variables: Record<string, number>;
  flags: FlagData;
}

/**
 * Persistent game state that outlives any one map: switches, variables and
 * every event's own flags. Unset switches and flags read as false and unset
 * variables as 0. Saves store exactly this.
 */
export class GameState {
  private readonly switches = new Map<string, boolean>();
  private readonly variables = new Map<string, number>();
  /** "<map>\n<event>" → the flags that are on. */
  private readonly flags = new Map<string, Set<string>>();
  private changes = 0;

  /** Ids declared in the manifest. When set, unknown ids throw (catches typos at runtime). */
  private readonly declared: { switches: Set<string>; variables: Set<string> } | null;

  constructor(manifest?: Pick<Manifest, 'switches' | 'variables'>) {
    this.declared = manifest
      ? {
          switches: new Set(manifest.switches.map((s) => s.id)),
          variables: new Set(manifest.variables.map((v) => v.id)),
        }
      : null;
  }

  private checkSwitch(id: string): void {
    if (this.declared && !this.declared.switches.has(id)) {
      throw new Error(`undeclared switch "${id}"`);
    }
  }

  private checkVariable(id: string): void {
    if (this.declared && !this.declared.variables.has(id)) {
      throw new Error(`undeclared variable "${id}"`);
    }
  }

  /** Plain data of every switch and variable that has been set, and every flag that's on. */
  toData(): GameStateData {
    const flags: FlagData = {};
    for (const [key, set] of this.flags) {
      if (set.size === 0) continue;
      const [map = '', event = ''] = key.split('\n');
      (flags[map] ??= {})[event] = [...set].sort();
    }
    return {
      switches: Object.fromEntries(this.switches),
      variables: Object.fromEntries(this.variables),
      flags,
    };
  }

  /**
   * Restore from `toData()`. Ids the manifest no longer declares are dropped,
   * so a save made before the project changed still loads.
   */
  loadData(data: Omit<GameStateData, 'flags'> & { readonly flags?: FlagData | undefined }): void {
    this.switches.clear();
    this.variables.clear();
    this.flags.clear();
    // Flags of events that no longer exist are kept: they're harmless and cheap.
    for (const [map, events] of Object.entries(data.flags ?? {})) {
      for (const [event, ids] of Object.entries(events)) {
        if (ids.length > 0) this.flags.set(flagKey(map, event), new Set(ids));
      }
    }
    for (const [id, value] of Object.entries(data.switches)) {
      if (!this.declared || this.declared.switches.has(id)) this.switches.set(id, value);
    }
    for (const [id, value] of Object.entries(data.variables)) {
      if (!this.declared || this.declared.variables.has(id)) this.variables.set(id, value);
    }
    this.changes++;
  }

  /** Increases on every write. Lets callers cheaply detect that state may have changed. */
  get version(): number {
    return this.changes;
  }

  getSwitch(id: string): boolean {
    this.checkSwitch(id);
    return this.switches.get(id) ?? false;
  }

  setSwitch(id: string, value: boolean): void {
    this.checkSwitch(id);
    this.switches.set(id, value);
    this.changes++;
  }

  getVariable(id: string): number {
    this.checkVariable(id);
    return this.variables.get(id) ?? 0;
  }

  setVariable(id: string, value: number): void {
    this.checkVariable(id);
    if (!Number.isSafeInteger(value)) {
      throw new Error(`variable "${id}": ${value} is not an integer`);
    }
    this.variables.set(id, value);
    this.changes++;
  }

  /** One of an event's own flags (events are told apart by map and event id). */
  getFlag(map: string, event: string, flag: string): boolean {
    return this.flags.get(flagKey(map, event))?.has(flag) ?? false;
  }

  setFlag(map: string, event: string, flag: string, value: boolean): void {
    const key = flagKey(map, event);
    let set = this.flags.get(key);
    if (!set) this.flags.set(key, (set = new Set()));
    if (value) set.add(flag);
    else set.delete(flag);
    this.changes++;
  }

  /** Apply `variable <op>= operand`. Division truncates toward zero; division by zero leaves the value unchanged. */
  applyVariable(id: string, op: VariableOp, operand: Operand | number): void {
    const rhs = typeof operand === 'number' ? operand : this.getVariable(operand.variable);
    const lhs = this.getVariable(id);
    this.setVariable(id, applyOp(lhs, op, rhs));
  }
}

function flagKey(map: string, event: string): string {
  return `${map}\n${event}`;
}

function applyOp(lhs: number, op: VariableOp, rhs: number): number {
  switch (op) {
    case 'set':
      return rhs;
    case 'add':
      return lhs + rhs;
    case 'sub':
      return lhs - rhs;
    case 'mul':
      return lhs * rhs;
    case 'div':
      return rhs === 0 ? lhs : Math.trunc(lhs / rhs);
    case 'mod':
      return rhs === 0 ? lhs : lhs % rhs;
  }
}

function compare(lhs: number, op: CompareOp, rhs: number): boolean {
  switch (op) {
    case '==':
      return lhs === rhs;
    case '!=':
      return lhs !== rhs;
    case '<':
      return lhs < rhs;
    case '<=':
      return lhs <= rhs;
    case '>':
      return lhs > rhs;
    case '>=':
      return lhs >= rhs;
  }
}

/**
 * What event conditions and commands read and change. `party` is optional so
 * code that only deals with switches and variables can pass a bare GameState.
 */
export interface EventContext {
  readonly state: GameState;
  readonly party?: Party;
  /** Where playMusic/playSound commands go. Without one they are silent. */
  readonly audio?: AudioSink;
  /** Starts moveRoute commands (the world). Without one, moveRoute fails clearly. */
  readonly routes?: RouteHost;
  /** The id of the map event whose commands these are ("this" in a move route), if any. */
  readonly self?: string | null;
  /** The current map's id (event flags belong to an event on a map). */
  readonly map?: string;
  /** The commands of a common event, for callCommon (throws for an unknown id). */
  readonly commonEvent?: (id: string) => readonly Command[];
  /** Fades, tints, flashes and shakes (the world's). Without one they do nothing. */
  readonly screen?: ScreenEffects;
  /** Hide an event on the map (or show it again) until the map loads again. */
  readonly hideEvent?: (id: string, hidden: boolean) => void;
  /** Hide the player (or show them again). Without one it does nothing. */
  readonly hidePlayer?: (hidden: boolean) => void;
  /** Whether an input action is held (the world's input this step). Without one, nothing is. */
  readonly held?: (action: InputAction) => boolean;
  /** The player ("player") or a map event by id, or null if there's no such character. */
  readonly character?: (id: string) => CharacterPlace | null;
  /** Put a map event on a tile (ignored outside the map). */
  readonly placeEvent?: (id: string, x: number, y: number, direction?: Direction) => void;
  /** The view's scroll away from the player. Without one, scrollMap does nothing. */
  readonly scroll?: MapScroll;
  /** Turn the menu or saving on or off. */
  readonly setAccess?: (what: 'menu' | 'saving', allowed: boolean) => void;
  /** Seconds played so far. */
  readonly playSeconds?: () => number;
  /** Uniform random in [0, 1), for random numbers. Defaults to Math.random. */
  readonly random?: () => number;
}

/** Where a character stands and faces. */
export interface CharacterPlace {
  readonly x: number;
  readonly y: number;
  readonly direction: Direction;
}

/** A character an event names: "player", "this" (the event itself) or an event id. */
export function characterFor(context: EventContext, target: string): CharacterPlace | null {
  const id = target === 'this' ? context.self : target;
  if (!id) return null;
  return context.character?.(id) ?? null;
}

/** Starts move routes for the interpreter. */
export interface RouteHost {
  /** Start a route; returns a check that's true once it has finished (or was replaced). */
  start(command: CommandOf<'moveRoute'>, self: string | null): () => boolean;
}

/** Receives the audio an event asks for; the runtime turns it into sound. */
export interface AudioSink {
  playMusic(path: string | null): void;
  playSound(path: string): void;
  /** A looping sound beside the music; null stops it. */
  playBackgroundSound?(path: string | null): void;
  /** Battle or victory music; null goes back to the project's own. */
  setBattleMusic?(which: 'battle' | 'victory', path: string | null): void;
}

/** Accept either a full context or just a GameState. */
export function toEventContext(context: EventContext | GameState): EventContext {
  return context instanceof GameState ? { state: context } : context;
}

/** Which event's flags `self` means here, or a clear error outside a map event. */
export function requireEvent(
  context: EventContext,
  what: string,
  event?: string,
): { map: string; event: string } {
  const id = event ?? context.self;
  if (!context.map || !id) throw new Error(`${what} needs a map event, but there is none here`);
  return { map: context.map, event: id };
}

/** The party, or a clear error for party commands/conditions run without one. */
export function requireParty(context: EventContext, what: string): Party {
  if (!context.party) throw new Error(`${what} needs the party, but none was provided`);
  return context.party;
}

export function evaluateCondition(
  condition: IfCondition,
  context: EventContext | GameState,
): boolean {
  const ctx = toEventContext(context);
  switch (condition.type) {
    case 'switch':
      return ctx.state.getSwitch(condition.switch) === condition.value;
    case 'variable':
      return compare(ctx.state.getVariable(condition.variable), condition.op, condition.value);
    case 'gold':
      return compare(requireParty(ctx, 'a gold condition').gold, condition.op, condition.value);
    case 'hasItem': {
      const party = requireParty(ctx, 'an item condition');
      const needed = condition.count ?? 1;
      if (condition.includeEquipped && condition.kind === 'equipment') {
        const worn = party.members.filter((m) =>
          [...m.equipment.values()].includes(condition.id),
        ).length;
        return party.count('equipment', condition.id) + worn >= needed;
      }
      return party.count(condition.kind, condition.id) >= needed;
    }
    case 'inParty':
      return requireParty(ctx, 'a party condition').hasMember(condition.actor);
    case 'flag': {
      const { map, event } = requireEvent(ctx, 'a flag condition');
      return ctx.state.getFlag(map, event, condition.flag) === condition.value;
    }
    case 'held':
      return ctx.held?.(condition.action) ?? false;
    case 'facing':
      return characterFor(ctx, condition.target)?.direction === condition.direction;
    case 'actorState': {
      const member = requireParty(ctx, 'an actor condition').member(condition.actor);
      return (member?.hasState(condition.state) ?? false) === condition.value;
    }
    case 'actorStat': {
      const member = requireParty(ctx, 'an actor condition').member(condition.actor);
      const percent = (value: number, max: number) => (max > 0 ? (value * 100) / max : 0);
      const value = !member
        ? 0
        : condition.stat === 'level'
          ? member.level
          : condition.stat === 'hp'
            ? member.hp
            : condition.stat === 'mp'
              ? member.mp
              : condition.stat === 'hpPercent'
                ? percent(member.hp, member.maxHp)
                : percent(member.mp, member.maxMp);
      return compare(value, condition.op, condition.value);
    }
    case 'actorName':
      return requireParty(ctx, 'an actor condition').actorName(condition.actor) === condition.name;
  }
}

/** The number a setVariable value stands for, now. */
export function variableValue(value: VariableValue, context: EventContext | GameState): number {
  const ctx = toEventContext(context);
  if (typeof value === 'number') return value;
  if ('variable' in value) return ctx.state.getVariable(value.variable);
  if ('random' in value) {
    const { min, max } = value.random;
    const low = Math.min(min, max);
    const high = Math.max(min, max);
    return low + Math.floor((ctx.random ?? Math.random)() * (high - low + 1));
  }
  const game = value.game;
  switch (game.type) {
    case 'gold':
      return requireParty(ctx, 'gold').gold;
    case 'steps':
      return requireParty(ctx, 'steps').steps;
    case 'partySize':
      return requireParty(ctx, 'the party size').members.length;
    case 'playTime':
      return Math.floor(ctx.playSeconds?.() ?? 0);
    case 'itemCount':
      return requireParty(ctx, 'an item count').count(game.kind, game.id);
    case 'actorStat': {
      const member = requireParty(ctx, 'an actor stat').member(game.actor);
      if (!member) return 0;
      if (game.stat === 'level') return member.level;
      if (game.stat === 'exp') return member.exp;
      if (game.stat === 'hp') return member.hp;
      if (game.stat === 'mp') return member.mp;
      return member.stat(game.stat);
    }
    case 'position': {
      const place = characterFor(ctx, game.target);
      return place ? place[game.axis] : 0;
    }
  }
}

/** True when every condition holds (and for an empty list). */
export function evaluateConditions(
  conditions: readonly IfCondition[],
  context: EventContext | GameState,
): boolean {
  const ctx = toEventContext(context);
  return conditions.every((c) => evaluateCondition(c, ctx));
}
