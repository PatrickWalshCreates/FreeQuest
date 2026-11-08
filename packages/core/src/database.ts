import type {
  ActorEntry,
  ClassEntry,
  Database,
  EnemyEntry,
  EquipmentEntry,
  ExpCurve,
  ItemEntry,
  LevelCurve,
  SkillEntry,
  StateEntry,
} from '@freequest/schema';

class Lookup<T extends { id: string }> {
  private readonly byId: ReadonlyMap<string, T>;

  constructor(
    readonly all: readonly T[],
    private readonly kind: string,
  ) {
    this.byId = new Map(all.map((entry) => [entry.id, entry]));
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  find(id: string): T | undefined {
    return this.byId.get(id);
  }

  /** Look up an entry, throwing a readable error if the id is unknown. */
  get(id: string): T {
    const entry = this.byId.get(id);
    if (!entry) throw new Error(`unknown ${this.kind} "${id}"`);
    return entry;
  }
}

/** The database with fast lookups by id. Entries are read-only data. */
export class DatabaseIndex {
  readonly actors: Lookup<ActorEntry>;
  readonly classes: Lookup<ClassEntry>;
  readonly skills: Lookup<SkillEntry>;
  readonly items: Lookup<ItemEntry>;
  readonly equipment: Lookup<EquipmentEntry>;
  readonly states: Lookup<StateEntry>;
  readonly enemies: Lookup<EnemyEntry>;
  /** The state that means "knocked out", if the database defines one. */
  readonly knockoutState: StateEntry | undefined;

  constructor(readonly data: Database) {
    this.actors = new Lookup(data.actors, 'actor');
    this.classes = new Lookup(data.classes, 'class');
    this.skills = new Lookup(data.skills, 'skill');
    this.items = new Lookup(data.items, 'item');
    this.equipment = new Lookup(data.equipment, 'equipment');
    this.states = new Lookup(data.states, 'state');
    this.enemies = new Lookup(data.enemies, 'enemy');
    this.knockoutState = data.states.find((s) => s.knockout);
  }

  get system(): Database['system'] {
    return this.data.system;
  }
}

/**
 * Value of a level curve at `level`: straight lines between the defined
 * points, flat before the first and after the last. Rounded to an integer.
 */
export function curveValue(curve: LevelCurve, level: number): number {
  const points = Object.entries(curve)
    .map(([l, v]) => [Number(l), v] as const)
    .sort((x, y) => x[0] - y[0]);
  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return 0;
  if (level <= first[0]) return first[1];
  if (level >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [l1, v1] = points[i] ?? first;
    const [l0, v0] = points[i - 1] ?? first;
    if (level <= l1) return Math.round(v0 + ((v1 - v0) * (level - l0)) / (l1 - l0));
  }
  return last[1];
}

/** Total experience needed to reach `level` (0 for level 1). */
export function expForLevel(curve: ExpCurve, level: number): number {
  return level <= 1 ? 0 : Math.round(curve.base * (level - 1) ** curve.exponent);
}
