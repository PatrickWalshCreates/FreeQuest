import type { CompareOp, Condition, Manifest, Operand, VariableOp } from '@freequest/schema';
import type { Party } from './party.js';

/**
 * Persistent game state that outlives any one map: switches and variables.
 * Unset switches read as false and unset variables as 0. Will be what
 * save/load serializes (M5).
 */
export class GameState {
  private readonly switches = new Map<string, boolean>();
  private readonly variables = new Map<string, number>();
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

  /** Plain data of every switch and variable that has been set (for save files). */
  toData(): { switches: Record<string, boolean>; variables: Record<string, number> } {
    return {
      switches: Object.fromEntries(this.switches),
      variables: Object.fromEntries(this.variables),
    };
  }

  /**
   * Restore from `toData()`. Ids the manifest no longer declares are dropped,
   * so a save made before the project changed still loads.
   */
  loadData(data: { switches: Record<string, boolean>; variables: Record<string, number> }): void {
    this.switches.clear();
    this.variables.clear();
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

  /** Apply `variable <op>= operand`. Division truncates toward zero; division by zero leaves the value unchanged. */
  applyVariable(id: string, op: VariableOp, operand: Operand): void {
    const rhs = typeof operand === 'number' ? operand : this.getVariable(operand.variable);
    const lhs = this.getVariable(id);
    this.setVariable(id, applyOp(lhs, op, rhs));
  }
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
}

/** Accept either a full context or just a GameState. */
export function toEventContext(context: EventContext | GameState): EventContext {
  return context instanceof GameState ? { state: context } : context;
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
