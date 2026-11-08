import type { CharacterSheet } from '../character.js';
import type { DatabaseKind, Manifest } from '../manifest.js';
import type { FileData } from '../validate.js';
import type {
  ActorEntry,
  ClassEntry,
  EnemyEntry,
  EquipmentEntry,
  ItemEntry,
  SkillEntry,
  StateEntry,
  SystemData,
} from './categories.js';
import { STAT_KEYS } from './common.js';
import type { Effect } from './effect.js';
import type { Modifier } from './modifier.js';

/** Every database category, loaded. Missing files load as empty. */
export interface Database {
  readonly system: SystemData;
  readonly actors: readonly ActorEntry[];
  readonly classes: readonly ClassEntry[];
  readonly skills: readonly SkillEntry[];
  readonly items: readonly ItemEntry[];
  readonly equipment: readonly EquipmentEntry[];
  readonly states: readonly StateEntry[];
  readonly enemies: readonly EnemyEntry[];
}

export function emptySystem(): SystemData {
  return {
    formatVersion: 1,
    currency: 'G',
    elements: [],
    equipmentSlots: [],
    equipmentTypes: [],
    skillTypes: [],
  };
}

export function emptyDatabase(): Database {
  return {
    system: emptySystem(),
    actors: [],
    classes: [],
    skills: [],
    items: [],
    equipment: [],
    states: [],
    enemies: [],
  };
}

/** Parsed database files by kind; any may be missing. */
export type DatabaseFiles = { readonly [K in DatabaseKind]?: FileData<K> };

/** Combine parsed database files into one Database. Missing categories are empty. */
export function assembleDatabase(files: DatabaseFiles): Database {
  return {
    system: files.system ?? emptySystem(),
    actors: files.actors?.entries ?? [],
    classes: files.classes?.entries ?? [],
    skills: files.skills?.entries ?? [],
    items: files.items?.entries ?? [],
    equipment: files.equipment?.entries ?? [],
    states: files.states?.entries ?? [],
    enemies: files.enemies?.entries ?? [],
  };
}

/** Effect `element` value meaning "the user's attack element". */
export const ATTACK_ELEMENT = 'attack';

/**
 * Check the database for duplicate ids and broken references between its
 * categories, the manifest's starting party, and character sheets.
 * `checkFormula` (optional) validates formula strings.
 */
export function checkDatabase(
  db: Database,
  context: {
    manifest?: Manifest;
    characters?: ReadonlyMap<string, CharacterSheet>;
    checkFormula?: (formula: string) => string | null;
  } = {},
): string[] {
  const problems: string[] = [];
  const ids = (list: readonly { id: string }[], where: string): Set<string> => {
    const seen = new Set<string>();
    for (const { id } of list) {
      if (seen.has(id)) problems.push(`${where}: duplicate id "${id}"`);
      seen.add(id);
    }
    return seen;
  };

  const elements = ids(db.system.elements, 'system elements');
  const slots = ids(db.system.equipmentSlots, 'system equipmentSlots');
  const equipmentTypes = ids(db.system.equipmentTypes, 'system equipmentTypes');
  const skillTypes = ids(db.system.skillTypes, 'system skillTypes');
  const actors = ids(db.actors, 'actors');
  const classes = ids(db.classes, 'classes');
  const skills = ids(db.skills, 'skills');
  const items = ids(db.items, 'items');
  const equipment = ids(db.equipment, 'equipment');
  const states = ids(db.states, 'states');
  ids(db.enemies, 'enemies');

  const need = (set: Set<string>, id: string, kind: string, where: string) => {
    if (!set.has(id)) problems.push(`${where}: unknown ${kind} "${id}"`);
  };

  const checkModifiers = (modifiers: readonly Modifier[], where: string) => {
    for (const m of modifiers) {
      if (m.type === 'elementRate' || m.type === 'attackElement') {
        need(elements, m.element, 'element', where);
      } else if (m.type === 'stateRate') need(states, m.state, 'state', where);
      else if (m.type === 'equipType')
        need(equipmentTypes, m.equipmentType, 'equipment type', where);
    }
  };

  const checkEffects = (effects: readonly Effect[], where: string) => {
    effects.forEach((e, i) => {
      const at = `${where} effects[${i}]`;
      if (e.type === 'damage' || e.type === 'recover') {
        const error = context.checkFormula?.(e.formula);
        if (error) problems.push(`${at}: formula "${e.formula}": ${error}`);
      }
      if (e.type === 'damage' && e.element !== undefined && e.element !== ATTACK_ELEMENT) {
        need(elements, e.element, 'element', at);
      }
      if (e.type === 'addState' || e.type === 'removeState') need(states, e.state, 'state', at);
      if (e.type === 'learnSkill') need(skills, e.skill, 'skill', at);
    });
  };

  for (const c of db.classes) {
    const where = `classes "${c.id}"`;
    for (const stat of STAT_KEYS) {
      if (c.stats[stat]['1'] === undefined) {
        problems.push(`${where} stats.${stat}: must define level 1`);
      }
    }
    for (const learn of c.skills) need(skills, learn.skill, 'skill', `${where} skills`);
    checkModifiers(c.modifiers, where);
  }

  const equipmentById = new Map(db.equipment.map((e) => [e.id, e]));
  const classById = new Map(db.classes.map((c) => [c.id, c]));
  for (const a of db.actors) {
    const where = `actors "${a.id}"`;
    need(classes, a.class, 'class', where);
    if (context.characters && !context.characters.has(a.character)) {
      problems.push(`${where}: unknown character "${a.character}"`);
    }
    if (a.level > a.maxLevel) problems.push(`${where}: level ${a.level} is above maxLevel`);
    checkModifiers(a.modifiers, where);
    const allowed = new Set(
      [...a.modifiers, ...(classById.get(a.class)?.modifiers ?? [])].flatMap((m) =>
        m.type === 'equipType' ? [m.equipmentType] : [],
      ),
    );
    for (const [slot, itemId] of Object.entries(a.equipment)) {
      need(slots, slot, 'equipment slot', `${where} equipment`);
      const item = equipmentById.get(itemId);
      if (!item) {
        problems.push(`${where} equipment.${slot}: unknown equipment "${itemId}"`);
      } else if (item.slot !== slot) {
        problems.push(`${where} equipment.${slot}: "${itemId}" goes in slot "${item.slot}"`);
      } else if (!allowed.has(item.equipmentType)) {
        problems.push(
          `${where} equipment.${slot}: cannot equip type "${item.equipmentType}" (no equipType modifier)`,
        );
      }
    }
  }

  for (const s of db.skills) {
    const where = `skills "${s.id}"`;
    if (s.skillType !== undefined) need(skillTypes, s.skillType, 'skill type', where);
    checkEffects(s.effects, where);
  }
  for (const it of db.items) checkEffects(it.effects, `items "${it.id}"`);
  for (const e of db.equipment) {
    const where = `equipment "${e.id}"`;
    need(slots, e.slot, 'equipment slot', where);
    need(equipmentTypes, e.equipmentType, 'equipment type', where);
    checkModifiers(e.modifiers, where);
  }
  for (const st of db.states) {
    const where = `states "${st.id}"`;
    const turns = st.removal.turns;
    if (turns && turns.min > turns.max) problems.push(`${where} removal.turns: min > max`);
    checkModifiers(st.modifiers, where);
  }
  for (const en of db.enemies) {
    const where = `enemies "${en.id}"`;
    en.drops.forEach((d, i) =>
      need(d.kind === 'item' ? items : equipment, d.id, d.kind, `${where} drops[${i}]`),
    );
    en.actions.forEach((act, i) => need(skills, act.skill, 'skill', `${where} actions[${i}]`));
    checkModifiers(en.modifiers, where);
  }

  if (context.manifest) {
    for (const id of context.manifest.start.party) {
      need(actors, id, 'actor', 'project.json start.party');
    }
  }
  return problems;
}
