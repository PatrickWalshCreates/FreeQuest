// What the project offers to forms: the dropdown choices for fields that
// refer to maps, switches, items…, and display names for command rows.
import { type NameLookup, type OpenedProject, textProblems } from '@freequest/editor-core';
import { ATTACK_ELEMENT, ID_PATTERN, SOUND_KEYS, checkFormula } from '@freequest/schema';

const ID_RE = new RegExp(ID_PATTERN);
import type { FormContext, RefOption } from './SchemaField.js';

interface Named {
  readonly id: string;
  readonly name?: string;
}

const options = (list: readonly Named[]): RefOption[] =>
  list.map((x) => ({
    value: x.id,
    label: x.name && x.name !== x.id ? `${x.name} (${x.id})` : x.id,
  }));

/** Field labels that read better than the generated ones. */
const LABELS: Record<string, string> = {
  face: 'Face',
  id: 'Item',
  skipBlocked: 'Skip blocked steps',
  wait: 'Wait until done',
  canSell: 'Can sell',
  percent: 'Percent of max HP',
  from: 'From turn',
  every: 'Then every (turns; 0 = only that turn)',
  has: 'Has it',
  goods: 'Goods',
  op: 'Operation',
  x: 'X',
  y: 'Y',
  path: 'File',
  onWin: 'If won',
  onEscape: 'If escaped',
  onLose: 'If lost',
  else: 'Else',
  canLose: 'Can lose (the event continues)',
  cancel: 'Cancel picks option (0 = first)',
  maxHp: 'Max HP',
  maxMp: 'Max MP',
  mpCost: 'MP cost',
  hpRegen: 'HP regeneration',
  successRate: 'Success rate (0–1)',
  chance: 'Chance (0–1)',
  flag: 'Flag',
  to: 'Fade',
  color: 'Colour',
  strength: 'Strength (0–1)',
  power: 'Power (pixels)',
  hidden: 'Hidden',
  common: 'Common event',
  trigger: 'Starts when',
  switch: 'Switch',
  event: 'Another event (none: this one)',
};

/** Fields whose text may hold `{…}` codes (messages, speakers, choice labels). */
const TEXT_FIELDS = new Set(['text', 'speaker', 'label']);

/** How a common event's triggers read in its form. */
const COMMON_TRIGGERS: Record<string, string> = {
  call: 'Only when an event calls it',
  autorun: 'Autorun (when nothing else runs, while its switch is on)',
  parallel: 'Parallel (alongside play, while its switch is on)',
};

export interface ProjectLists {
  /** Audio files in the project, for music and sound fields. */
  readonly audio: readonly string[];
  /** Image files, for enemy pictures and the iconset. */
  readonly images?: readonly string[];
  /** Events on the map being edited, for move route targets. */
  readonly events?: readonly { readonly id: string; readonly name: string }[];
  /** Event flag names the map already uses, offered while typing a flag. */
  readonly flags?: readonly string[];
}

/** Starting values that make new entries useful at once (an item that works, a normal enemy action). */
const NUMBER_DEFAULTS: Record<string, number | boolean> = {
  successRate: 1,
  rating: 5,
  chance: 1,
  variance: 0.2,
  level: 1,
  maxLevel: 99,
  consumable: true,
  canSell: true,
  // Screen effects: a second, half strength, a clear shake, and wait for it.
  seconds: 1,
  strength: 0.5,
  power: 6,
  wait: true,
};

const AUDIO_FIELDS = new Set<string>([
  'path',
  'titleMusic',
  'battleMusic',
  'victoryMusic',
  'gameOverMusic',
  ...SOUND_KEYS,
]);

export function projectFormContext(project: OpenedProject, lists: ProjectLists): FormContext {
  const m = project.manifest.data;
  type EntryKind =
    | 'actors'
    | 'classes'
    | 'skills'
    | 'items'
    | 'equipment'
    | 'states'
    | 'enemies'
    | 'troops'
    | 'commonEvents';
  const db = (kind: EntryKind): Named[] =>
    (project.database[kind]?.data?.entries as Named[] | undefined) ?? [];
  const system = project.database.system?.data;
  const maps = [...project.maps].map(([id, f]) => ({ id, name: f.data?.name ?? id }));
  const characters = [...project.characters].map(([id, f]) => ({ id, name: f.data?.name ?? id }));
  const files = (paths: readonly string[]) =>
    paths.map((p) => ({ value: p, label: p.replace(/^assets\//, '') }));
  const audio = files(lists.audio);
  const images = files(lists.images ?? []);
  const variables = new Set(m.variables.map((v) => v.id));

  const refs: FormContext['refs'] = (field, parent) => {
    switch (field) {
      case 'map':
        return options(maps);
      case 'switch':
        return options(m.switches);
      case 'variable':
        return options(m.variables);
      case 'troop':
        return options(db('troops'));
      case 'actor':
        return options(db('actors'));
      case 'character':
        return options(characters);
      case 'id':
        return options(parent?.['kind'] === 'equipment' ? db('equipment') : db('items'));
      case 'class':
        return options(db('classes'));
      case 'skill':
      case 'attackSkill':
      case 'guardSkill':
        return options(db('skills'));
      case 'state':
        return options(db('states'));
      case 'enemies':
        return options(db('enemies'));
      case 'element': {
        const elements = options(system?.elements ?? []);
        // Damage can use whatever element the user attacks with.
        return parent?.['type'] === 'damage'
          ? [{ value: ATTACK_ELEMENT, label: '(the user’s attack element)' }, ...elements]
          : elements;
      }
      case 'equipmentType':
        return options(system?.equipmentTypes ?? []);
      case 'slot':
      case 'equipment:key':
        return options(system?.equipmentSlots ?? []);
      case 'equipment:value':
        return options(db('equipment'));
      case 'skillType':
        return options(system?.skillTypes ?? []);
      case 'image':
        return images;
      case 'event':
        return options(lists.events ?? []);
      case 'common':
        return options(db('commonEvents'));
      case 'target':
        return [
          { value: 'this', label: 'This event' },
          { value: 'player', label: 'The player' },
          ...options(lists.events ?? []),
        ];
      default:
        return AUDIO_FIELDS.has(field) ? audio : null;
    }
  };
  return {
    refs,
    multiline: (field) => field === 'text' || field === 'description',
    choiceLabel: (field, value) =>
      field === 'trigger'
        ? COMMON_TRIGGERS[value]
        : field === 'to'
          ? { out: 'Out (to black)', in: 'In (back from black)' }[value]
          : undefined,
    suggest: (field) => (field === 'flag' ? (lists.flags ?? []) : []),
    check: (field, value, parent) => {
      if (field === 'formula' && typeof value === 'string' && value !== '') {
        return checkFormula(value, variables);
      }
      // Comments are notes for authors: their text is never shown, so codes don't matter.
      if (TEXT_FIELDS.has(field) && typeof value === 'string' && parent?.['type'] !== 'comment') {
        const problems = textProblems(value, project);
        return problems.length > 0 ? problems.join(' · ') : null;
      }
      if (field === 'flag' && typeof value === 'string' && !ID_RE.test(value)) {
        return 'Use lowercase letters, digits, "-" and "_" (e.g. opened)';
      }
      return null;
    },
    label: (field) => LABELS[field],
    pick: (field) => {
      if (field in NUMBER_DEFAULTS) return NUMBER_DEFAULTS[field];
      if (field === 'flag') return lists.flags?.[0] ?? 'done';
      if (field === 'color') return '#ffffff';
      const first = refs(field, null)?.[0];
      return first ? first.value : undefined;
    },
  };
}

/** Names for command descriptions, falling back to ids for anything missing. */
export function projectNames(
  project: OpenedProject,
  events: readonly { readonly id: string; readonly name: string }[] = [],
): NameLookup {
  const m = project.manifest.data;
  const find = (list: readonly Named[] | undefined, id: string) =>
    list?.find((x) => x.id === id)?.name ?? id;
  const entries = (kind: 'actors' | 'items' | 'equipment' | 'troops' | 'commonEvents') =>
    project.database[kind]?.data?.entries as Named[] | undefined;
  return {
    map: (id) => project.maps.get(id)?.data?.name ?? id,
    switchName: (id) => find(m.switches, id),
    variable: (id) => find(m.variables, id),
    actor: (id) => find(entries('actors'), id),
    item: (kind, id) => find(entries(kind === 'equipment' ? 'equipment' : 'items'), id),
    troop: (id) => find(entries('troops'), id),
    common: (id) => find(entries('commonEvents'), id),
    event: (id) => find(events, id),
  };
}
