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
  tiles: 'Tiles',
  speed: 'Speed (tiles/s)',
  canKnockOut: 'Can knock out (otherwise stops at 1 HP)',
  allowed: 'Allowed',
  which: 'Music for',
  what: 'What',
  axis: 'Which',
  action: 'Key',
  target: 'Who',
  number: 'Picture number (higher ones are drawn on top)',
  origin: 'X and Y place its',
  scaleX: 'Width (%)',
  scaleY: 'Height (%)',
  opacity: 'Opacity (0–1)',
  frameWidth: 'Frame width (px)',
  frameHeight: 'Frame height (px)',
  frames: 'Frames',
  fps: 'Frames per second',
  frame: 'At frame (from 0)',
  note: 'Note (for you; not shown in the game)',
  animation: 'Animation',
  balloon: 'Balloon',
  balloons: 'Balloons over characters',
  size: 'Frame size (px, square)',
  names: 'Names (one per row, top first)',
  tpCost: 'TP cost (in battle)',
  tpGain: 'TP gained by the user (in battle)',
  repeats: 'Hits (times on each target)',
  turnEnd: 'Checked as the turn ends (not as it starts)',
  enemyHp: 'An enemy’s HP',
  actorHp: 'A party member’s HP',
  enemy: 'Enemy (0 = the first, left)',
  below: 'At or below (% of the most)',
  span: 'Runs',
  events: 'Battle events',
  place: 'Place (1 = the leader)',
  battleBackground: 'Battle background',
  ui: 'Windows',
  windowColor: 'Window colour',
  background: 'Background (instead of the game’s)',
};

/** Readable choices for fields whose values are words. */
const CHOICE_LABELS: Record<string, Record<string, string>> = {
  which: { battle: 'Battles', victory: 'Winning a battle' },
  what: {
    menu: 'Opening the menu',
    saving: 'Saving from the menu',
    formation: 'Changing the party’s order (Formation)',
  },
  axis: { x: 'X (across)', y: 'Y (down)' },
  action: { confirm: 'Confirm', cancel: 'Cancel', menu: 'Menu' },
  stat: {
    level: 'Level',
    exp: 'Experience',
    hp: 'HP',
    mp: 'MP',
    hpPercent: 'HP (% of most)',
    mpPercent: 'MP (% of most)',
    maxHp: 'Max HP',
    maxMp: 'Max MP',
    magicAttack: 'Magic attack',
    magicDefense: 'Magic defense',
  },
  direction: { back: 'Back to the player' },
  span: {
    battle: 'Once a battle',
    turn: 'Once a turn',
    moment: 'Every time it’s checked and holds',
  },
  origin: { 'top-left': 'Top-left corner', center: 'Centre' },
  type: {
    counterRate: 'Counterattack physical hits (chance)',
    reflectRate: 'Send magic back (chance)',
    magicEvasionRate: 'Dodge magic (chance)',
  },
  ability: {
    fewerEncounters: 'Half as many random battles',
    noEncounters: 'No random battles',
    doubleGold: 'Double gold after a win',
    doubleDrops: 'Double drop chances',
  },
  easing: {
    linear: 'Steady',
    'ease-in': 'Starts slow',
    'ease-out': 'Ends slow',
    'ease-in-out': 'Starts and ends slow',
  },
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
  /** Every file under assets/, for plugin asset parameters. */
  readonly assets?: readonly string[];
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
  // Scrolling the map: a few tiles at walking pace.
  tiles: 4,
  speed: 4,
  // Pictures: number 1, full size, solid.
  number: 1,
  scaleX: 100,
  scaleY: 100,
  opacity: 1,
  // A new animation: 8 frames of 32 px at 12 per second.
  frameWidth: 32,
  frameHeight: 32,
  frames: 8,
  fps: 12,
  // Buffs last a few turns; HP tests at half.
  turns: 3,
  below: 50,
  place: 1,
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
    | 'commonEvents'
    | 'animations';
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
      case 'battleBackground':
      case 'background':
        return images;
      case 'event':
        return options(lists.events ?? []);
      case 'common':
        return options(db('commonEvents'));
      case 'animation':
        return options(db('animations'));
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
  const plugins = (m.plugins ?? []).flatMap((ref) => {
    const declaration = project.plugins.get(ref.id)?.data;
    return declaration ? [{ declaration, enabled: ref.enabled }] : [];
  });
  return {
    refs,
    assets: (folder) => {
      const prefix = folder ? `${folder.replace(/\/+$/, '')}/` : 'assets/';
      return files((lists.assets ?? []).filter((p) => p.startsWith(prefix)));
    },
    plugins: () => plugins,
    multiline: (field) => field === 'text' || field === 'description',
    choiceLabel: (field, value) =>
      field === 'trigger'
        ? COMMON_TRIGGERS[value]
        : field === 'to'
          ? { out: 'Out (to black)', in: 'In (back from black)' }[value]
          : CHOICE_LABELS[field]?.[value],
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
      if (field === 'windowColor') return '#3a2030';
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
  const entries = (
    kind: 'actors' | 'items' | 'equipment' | 'troops' | 'commonEvents' | 'states' | 'animations',
  ) => project.database[kind]?.data?.entries as Named[] | undefined;
  return {
    map: (id) => project.maps.get(id)?.data?.name ?? id,
    switchName: (id) => find(m.switches, id),
    variable: (id) => find(m.variables, id),
    actor: (id) => find(entries('actors'), id),
    item: (kind, id) => find(entries(kind === 'equipment' ? 'equipment' : 'items'), id),
    troop: (id) => find(entries('troops'), id),
    common: (id) => find(entries('commonEvents'), id),
    event: (id) => find(events, id),
    character: (id) => project.characters.get(id)?.data?.name || id,
    state: (id) => find(entries('states'), id),
    animation: (id) => find(entries('animations'), id),
    balloon: (row) => project.database.system?.data?.balloons?.names[row] ?? `#${row}`,
    pluginCommand: (plugin, command) => {
      const declaration = project.plugins.get(plugin)?.data;
      const label = declaration?.commands.find((c) => c.id === command)?.label;
      return declaration && label ? `${declaration.name}: ${label}` : undefined;
    },
  };
}
