import type { EnemyEntry, Modifier, StatKey } from '@freequest/schema';
import { Battler } from './battler.js';
import type { DatabaseIndex } from './database.js';
import { skillProblem } from './effects.js';
import type { InventoryKind } from './party.js';

export interface Drop {
  readonly kind: InventoryKind;
  readonly id: string;
}

/** An enemy in battle. Same rules as actors, with fixed stats from the database. */
export class Enemy extends Battler {
  readonly entry: EnemyEntry;
  /** Distinguishes duplicates in one battle, e.g. "A" in "Slime A". Empty when unique. */
  readonly suffix: string;

  constructor(db: DatabaseIndex, id: string, suffix = '') {
    super(db);
    this.entry = db.enemies.get(id);
    this.suffix = suffix;
    this.recoverAll();
  }

  get id(): string {
    return this.entry.id;
  }

  get name(): string {
    return this.suffix ? `${this.entry.name} ${this.suffix}` : this.entry.name;
  }

  /** Enemies have no levels; formulas reading `level` get 1. */
  get level(): number {
    return 1;
  }

  protected baseStat(stat: StatKey): number {
    return this.entry.stats[stat];
  }

  protected ownModifiers(): readonly Modifier[] {
    return this.entry.modifiers;
  }

  get exp(): number {
    return this.entry.exp;
  }

  get gold(): number {
    return this.entry.gold;
  }

  /** Roll each drop independently. */
  rollDrops(random: () => number): Drop[] {
    return this.entry.drops
      .filter((d) => random() < d.chance)
      .map((d) => ({ kind: d.kind, id: d.id }));
  }

  /**
   * Pick a skill to use: weighted by rating among actions it can use right
   * now (enough MP, usable in battle). Null if it can't act or has no option.
   */
  chooseAction(random: () => number): string | null {
    if (!this.canAct) return null;
    const options = this.entry.actions.filter(
      (a) => skillProblem(this, this.db.skills.get(a.skill), 'battle') === null,
    );
    const total = options.reduce((sum, a) => sum + a.rating, 0);
    let roll = random() * total;
    for (const option of options) {
      roll -= option.rating;
      if (roll < 0) return option.skill;
    }
    return options.at(-1)?.skill ?? null;
  }
}

/**
 * Create enemies for a battle, adding letter suffixes to duplicates:
 * ["slime", "bat", "slime"] → Slime A, Bat, Slime B.
 */
export function createEnemies(db: DatabaseIndex, ids: readonly string[]): Enemy[] {
  const totals = new Map<string, number>();
  for (const id of ids) totals.set(id, (totals.get(id) ?? 0) + 1);
  const seen = new Map<string, number>();
  return ids.map((id) => {
    const index = seen.get(id) ?? 0;
    seen.set(id, index + 1);
    const suffix = (totals.get(id) ?? 0) > 1 ? String.fromCharCode(65 + (index % 26)) : '';
    return new Enemy(db, id, suffix);
  });
}
