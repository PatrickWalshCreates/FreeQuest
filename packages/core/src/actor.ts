import type { ActorEntry, ClassEntry, Modifier, StatKey } from '@freequest/schema';
import { Battler, type StateInstance } from './battler.js';
import { type DatabaseIndex, curveValue, expForLevel } from './database.js';

/** Plain, serializable state of an actor (what save files will store). */
export interface ActorData {
  id: string;
  level: number;
  exp: number;
  hp: number;
  mp: number;
  /** Equipment id by slot id. */
  equipment: Record<string, string>;
  /** Skills learned outside the class's level table (e.g. from items). */
  extraSkills: string[];
  states: StateInstance[];
}

/** What happened when experience was gained. */
export interface LevelUpResult {
  readonly levelsGained: number;
  readonly learnedSkills: readonly string[];
}

/** A party member: database actor + class, with level, exp, equipment and skills. */
export class Actor extends Battler {
  readonly entry: ActorEntry;
  private currentLevel: number;
  private currentExp: number;
  private readonly equipped = new Map<string, string>();
  private readonly extraSkills = new Set<string>();

  constructor(db: DatabaseIndex, id: string) {
    super(db);
    this.entry = db.actors.get(id);
    this.currentLevel = this.entry.level;
    this.currentExp = expForLevel(this.classEntry.exp, this.currentLevel);
    for (const [slot, item] of Object.entries(this.entry.equipment)) this.equipped.set(slot, item);
    this.recoverAll();
  }

  /** Restore an actor from saved data. */
  static fromData(db: DatabaseIndex, data: ActorData): Actor {
    const actor = new Actor(db, data.id);
    actor.currentLevel = data.level;
    actor.currentExp = data.exp;
    actor.equipped.clear();
    for (const [slot, item] of Object.entries(data.equipment)) actor.equipped.set(slot, item);
    for (const skill of data.extraSkills) actor.extraSkills.add(skill);
    actor.stateList.push(...data.states.map((s) => ({ ...s })));
    actor.currentHp = 0;
    actor.currentMp = 0;
    actor.setHp(data.hp);
    actor.setMp(data.mp);
    return actor;
  }

  toData(): ActorData {
    return {
      id: this.entry.id,
      level: this.currentLevel,
      exp: this.currentExp,
      hp: this.currentHp,
      mp: this.currentMp,
      equipment: Object.fromEntries(this.equipped),
      extraSkills: [...this.extraSkills],
      states: this.stateList.map((s) => ({ ...s })),
    };
  }

  get id(): string {
    return this.entry.id;
  }

  get name(): string {
    return this.entry.name;
  }

  get classEntry(): ClassEntry {
    return this.db.classes.get(this.entry.class);
  }

  get level(): number {
    return this.currentLevel;
  }

  get exp(): number {
    return this.currentExp;
  }

  get maxLevel(): number {
    return this.entry.maxLevel;
  }

  /** Total exp needed for the next level, or null at max level. */
  get nextLevelExp(): number | null {
    return this.currentLevel >= this.maxLevel
      ? null
      : expForLevel(this.classEntry.exp, this.currentLevel + 1);
  }

  protected baseStat(stat: StatKey): number {
    return curveValue(this.classEntry.stats[stat], this.currentLevel);
  }

  protected ownModifiers(): readonly Modifier[] {
    const fromEquipment = [...this.equipped.values()].flatMap(
      (id) => this.db.equipment.get(id).modifiers,
    );
    return [...this.entry.modifiers, ...this.classEntry.modifiers, ...fromEquipment];
  }

  /** Equipment id per slot. */
  get equipment(): ReadonlyMap<string, string> {
    return this.equipped;
  }

  /**
   * Equipment types this actor may wear: from its own and its class's
   * `equipType` modifiers (deliberately not from equipment or states, so
   * gear can't grant permission to wear itself).
   */
  allowedEquipmentTypes(): Set<string> {
    return new Set(
      [...this.entry.modifiers, ...this.classEntry.modifiers].flatMap((m) =>
        m.type === 'equipType' ? [m.equipmentType] : [],
      ),
    );
  }

  /** Whether this actor could wear a piece of equipment (ignores inventory). */
  canEquip(equipmentId: string): boolean {
    const item = this.db.equipment.find(equipmentId);
    return item !== undefined && this.allowedEquipmentTypes().has(item.equipmentType);
  }

  /**
   * Put equipment in a slot (or empty it with null), without touching the
   * inventory; `Party.equip` handles that. Returns what was there before.
   */
  setEquipment(slot: string, equipmentId: string | null): string | null {
    const previous = this.equipped.get(slot) ?? null;
    if (equipmentId === null) {
      this.equipped.delete(slot);
    } else {
      const item = this.db.equipment.get(equipmentId);
      if (item.slot !== slot) {
        throw new Error(`"${equipmentId}" goes in slot "${item.slot}", not "${slot}"`);
      }
      if (!this.canEquip(equipmentId)) {
        throw new Error(`${this.name} cannot equip "${equipmentId}" (${item.equipmentType})`);
      }
      this.equipped.set(slot, equipmentId);
    }
    this.clampPools();
    return previous;
  }

  /** Skills known: the class's skills up to this level, plus any learned otherwise. */
  get skills(): string[] {
    const fromClass = this.classEntry.skills
      .filter((s) => s.level <= this.currentLevel)
      .map((s) => s.skill);
    return [...new Set([...fromClass, ...this.extraSkills])];
  }

  /**
   * Whether the actor can use a skill: learned ones, plus the system's Attack
   * and Guard, which every actor has as battle commands (they are not listed
   * in `skills`).
   */
  hasSkill(id: string): boolean {
    const { attackSkill, guardSkill } = this.db.system;
    return id === attackSkill || id === guardSkill || this.skills.includes(id);
  }

  learnSkill(id: string): void {
    this.db.skills.get(id); // validates the id
    this.extraSkills.add(id);
  }

  /** Gain experience, levelling up (possibly several times) as thresholds are crossed. */
  gainExp(amount: number): LevelUpResult {
    const cap = expForLevel(this.classEntry.exp, this.maxLevel);
    return this.setExp(Math.min(this.currentExp + Math.max(0, Math.round(amount)), cap));
  }

  /** Jump to a level (exp set to that level's threshold). Can go down. */
  changeLevel(level: number): LevelUpResult {
    const target = Math.min(Math.max(1, Math.round(level)), this.maxLevel);
    return this.setExp(expForLevel(this.classEntry.exp, target));
  }

  private setExp(exp: number): LevelUpResult {
    const before = this.currentLevel;
    const known = new Set(this.skills);
    this.currentExp = exp;
    let level = 1;
    while (level < this.maxLevel && expForLevel(this.classEntry.exp, level + 1) <= exp) level++;
    this.currentLevel = level;
    this.clampPools();
    return {
      levelsGained: level - before,
      learnedSkills: this.skills.filter((s) => !known.has(s)),
    };
  }
}
