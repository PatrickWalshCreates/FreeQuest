import type { CompareOp, Condition, Manifest, Operand, VariableOp } from '@freequest/schema';

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

export function evaluateCondition(condition: Condition, state: GameState): boolean {
  if (condition.type === 'switch') return state.getSwitch(condition.switch) === condition.value;
  return compare(state.getVariable(condition.variable), condition.op, condition.value);
}

/** True when every condition holds (and for an empty list). */
export function evaluateConditions(conditions: readonly Condition[], state: GameState): boolean {
  return conditions.every((c) => evaluateCondition(c, state));
}
