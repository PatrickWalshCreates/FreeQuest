import type {
  Command,
  CommandOf,
  CompareOp,
  Condition,
  Manifest,
  Operand,
  VariableOp,
} from '@freequest/schema';
import type { Party } from './party.js';

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
  applyVariable(id: string, op: VariableOp, operand: Operand): void {
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
  condition: Condition,
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
  }
}

/** True when every condition holds (and for an empty list). */
export function evaluateConditions(
  conditions: readonly Condition[],
  context: EventContext | GameState,
): boolean {
  const ctx = toEventContext(context);
  return conditions.every((c) => evaluateCondition(c, ctx));
}
