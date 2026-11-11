// Map events: placing, moving, pages, and the command tree. Pure functions
// over map data plus thin document wrappers, so every edit is one undo step.
import type {
  Command,
  Condition,
  EventPage,
  GameMap,
  MapEvent,
  MoveStep,
  Operand,
  VariableOp,
} from '@freequest/schema';
import { walkCommands } from '@freequest/schema';
import type { EditOptions, ProjectDocument } from './document.js';
import { inBounds } from './map-edits.js';

// Events ------------------------------------------------------------------

export function eventAt(map: GameMap, x: number, y: number): MapEvent | undefined {
  // The last one wins, matching what's drawn on top.
  return [...map.events].reverse().find((e) => e.x === x && e.y === y);
}

/** The first free id of the form event1, event2, … on this map. */
export function nextEventId(map: GameMap): string {
  const taken = new Set(map.events.map((e) => e.id));
  for (let n = 1; ; n++) if (!taken.has(`event${n}`)) return `event${n}`;
}

/** A page that does nothing yet: talked to, blocks like a character, no graphic. */
export function defaultPage(): EventPage {
  return { conditions: [], trigger: 'action', layer: 'same', commands: [] };
}

function withEvent(map: GameMap, id: string, change: (e: MapEvent) => MapEvent): GameMap {
  let found = false;
  const events = map.events.map((e) => {
    if (e.id !== id) return e;
    found = true;
    return change(e);
  });
  if (!found) throw new Error(`map "${map.id}" has no event "${id}"`);
  return events.every((e, i) => e === map.events[i]) ? map : { ...map, events };
}

function checkCell(map: GameMap, x: number, y: number): void {
  if (!inBounds(map, x, y)) throw new RangeError(`(${x}, ${y}) is outside map "${map.id}"`);
}

/** Add a new event at a cell. Returns the map and the new event's id. */
export function addEvent(map: GameMap, x: number, y: number): { map: GameMap; id: string } {
  checkCell(map, x, y);
  const id = nextEventId(map);
  const event: MapEvent = { id, name: `Event ${id.slice(5)}`, x, y, pages: [defaultPage()] };
  return { map: { ...map, events: [...map.events, event] }, id };
}

export function moveEvent(map: GameMap, id: string, x: number, y: number): GameMap {
  checkCell(map, x, y);
  return withEvent(map, id, (e) => (e.x === x && e.y === y ? e : { ...e, x, y }));
}

export function removeEvent(map: GameMap, id: string): GameMap {
  if (!map.events.some((e) => e.id === id)) throw new Error(`map "${map.id}" has no event "${id}"`);
  return { ...map, events: map.events.filter((e) => e.id !== id) };
}

/** Copy an event (all pages) to a cell under a new id. */
export function duplicateEvent(
  map: GameMap,
  id: string,
  x: number,
  y: number,
): { map: GameMap; id: string } {
  checkCell(map, x, y);
  const source = map.events.find((e) => e.id === id);
  if (!source) throw new Error(`map "${map.id}" has no event "${id}"`);
  const copyId = nextEventId(map);
  const copy: MapEvent = { ...source, id: copyId, name: `${source.name} (copy)`, x, y };
  return { map: { ...map, events: [...map.events, copy] }, id: copyId };
}

export function updateEvent(map: GameMap, id: string, change: (e: MapEvent) => MapEvent): GameMap {
  return withEvent(map, id, change);
}

/** Apply a change to one page of an event. */
export function updatePage(
  map: GameMap,
  id: string,
  page: number,
  change: (p: EventPage) => EventPage,
): GameMap {
  return withEvent(map, id, (e) => {
    const current = e.pages[page];
    if (!current) throw new RangeError(`event "${id}" has no page ${page + 1}`);
    const next = change(current);
    return next === current ? e : { ...e, pages: e.pages.map((p, i) => (i === page ? next : p)) };
  });
}

// Pages -------------------------------------------------------------------

export function addPage(event: MapEvent): MapEvent {
  return { ...event, pages: [...event.pages, defaultPage()] };
}

/** A copy of page `index`, inserted right after it. */
export function duplicatePage(event: MapEvent, index: number): MapEvent {
  const page = event.pages[index];
  if (!page) throw new RangeError(`event "${event.id}" has no page ${index + 1}`);
  return {
    ...event,
    pages: [...event.pages.slice(0, index + 1), page, ...event.pages.slice(index + 1)],
  };
}

/** Remove a page; an event always keeps at least one. */
export function removePage(event: MapEvent, index: number): MapEvent {
  if (event.pages.length <= 1) throw new Error('An event needs at least one page');
  if (!event.pages[index]) throw new RangeError(`event "${event.id}" has no page ${index + 1}`);
  return { ...event, pages: event.pages.filter((_, i) => i !== index) };
}

/** Move page `index` by `delta` places (later pages win when their conditions hold). */
export function movePage(event: MapEvent, index: number, delta: number): MapEvent {
  return { ...event, pages: moveItem(event.pages, index, delta) };
}

function moveItem<T>(list: readonly T[], index: number, delta: number): T[] {
  const target = index + delta;
  const item = list[index];
  if (item === undefined || target < 0 || target >= list.length) return [...list];
  const rest = list.filter((_, i) => i !== index);
  return [...rest.slice(0, target), item, ...rest.slice(target)];
}

// The command tree ----------------------------------------------------------

/** The named command lists a block command holds. */
export type Branch = 'then' | 'else' | 'onWin' | 'onEscape' | 'onLose' | 'option';

/** One step down the tree: into a branch of the command at `index`. */
export interface ListStep {
  readonly index: number;
  readonly branch: Branch;
  /** For `option`: which choice option. */
  readonly option?: number;
}

/** Where a command list is: [] is the page's own list. */
export type ListPath = readonly ListStep[];

function childList(command: Command | undefined, step: ListStep): readonly Command[] | undefined {
  if (!command) return undefined;
  switch (step.branch) {
    case 'then':
      return command.type === 'if' ? command.then : undefined;
    case 'else':
      return command.type === 'if' ? command.else : undefined;
    case 'onWin':
    case 'onEscape':
    case 'onLose':
      return command.type === 'battle' ? command[step.branch] : undefined;
    case 'option':
      return command.type === 'choice' ? command.options[step.option ?? 0]?.commands : undefined;
  }
}

function withChildList(command: Command, step: ListStep, list: Command[]): Command {
  switch (step.branch) {
    case 'then':
    case 'else':
      if (command.type !== 'if') break;
      return { ...command, [step.branch]: list };
    case 'onWin':
    case 'onEscape':
    case 'onLose':
      if (command.type !== 'battle') break;
      return { ...command, [step.branch]: list };
    case 'option':
      if (command.type !== 'choice') break;
      return {
        ...command,
        options: command.options.map((o, i) =>
          i === (step.option ?? 0) ? { ...o, commands: list } : o,
        ),
      };
  }
  throw new Error(`a ${command.type} command has no ${step.branch} branch`);
}

/** The command list at `path`. Throws if the path doesn't lead to one. */
export function getList(commands: readonly Command[], path: ListPath): readonly Command[] {
  let list = commands;
  for (const step of path) {
    const next = childList(list[step.index], step);
    if (!next) throw new Error(`no command list at ${describePath(path)}`);
    list = next;
  }
  return list;
}

/** Rebuild the tree with the list at `path` replaced by `change(list)`. */
export function updateList(
  commands: readonly Command[],
  path: ListPath,
  change: (list: readonly Command[]) => Command[],
): Command[] {
  const [step, ...rest] = path;
  if (!step) return change(commands);
  const command = commands[step.index];
  const child = childList(command, step);
  if (!command || !child) throw new Error(`no command list at ${describePath(path)}`);
  const next = withChildList(command, step, updateList(child, rest, change));
  return commands.map((c, i) => (i === step.index ? next : c));
}

function describePath(path: ListPath): string {
  return (
    path.map((s) => `[${s.index}].${s.branch}${s.option !== undefined ? s.option : ''}`).join('') ||
    'top'
  );
}

export function insertCommand(
  commands: readonly Command[],
  path: ListPath,
  index: number,
  command: Command,
): Command[] {
  return updateList(commands, path, (list) => [
    ...list.slice(0, index),
    command,
    ...list.slice(index),
  ]);
}

export function replaceCommand(
  commands: readonly Command[],
  path: ListPath,
  index: number,
  command: Command,
): Command[] {
  return updateList(commands, path, (list) => {
    if (!list[index]) throw new RangeError(`no command ${index} at ${describePath(path)}`);
    return list.map((c, i) => (i === index ? command : c));
  });
}

export function removeCommand(
  commands: readonly Command[],
  path: ListPath,
  index: number,
): Command[] {
  return updateList(commands, path, (list) => list.filter((_, i) => i !== index));
}

/** Move a command up or down within its own list. */
export function moveCommand(
  commands: readonly Command[],
  path: ListPath,
  index: number,
  delta: number,
): Command[] {
  return updateList(commands, path, (list) => moveItem(list, index, delta));
}

/** A row of the command list as the editor shows it: commands, branch headings and end slots. */
export type CommandRow =
  | {
      readonly kind: 'command';
      readonly path: ListPath;
      readonly index: number;
      readonly depth: number;
      readonly command: Command;
    }
  | { readonly kind: 'branch'; readonly depth: number; readonly label: string }
  /** The empty slot after a list's last command: where "add" appends. */
  | {
      readonly kind: 'end';
      readonly path: ListPath;
      readonly index: number;
      readonly depth: number;
    };

const BATTLE_BRANCHES = [
  ['onWin', 'If won'],
  ['onEscape', 'If escaped'],
  ['onLose', 'If lost'],
] as const;

/** Flatten a command tree into rows, depth first, each list ending in an end slot. */
export function flattenCommands(
  commands: readonly Command[],
  path: ListPath = [],
  depth = 0,
): CommandRow[] {
  const rows: CommandRow[] = [];
  const branch = (
    index: number,
    step: Omit<ListStep, 'index'>,
    label: string,
    list: readonly Command[],
  ) => {
    rows.push({ kind: 'branch', depth: depth + 1, label });
    rows.push(...flattenCommands(list, [...path, { ...step, index }], depth + 2));
  };
  commands.forEach((command, index) => {
    rows.push({ kind: 'command', path, index, depth, command });
    if (command.type === 'if') {
      rows.push(...flattenCommands(command.then, [...path, { index, branch: 'then' }], depth + 1));
      if (command.else) branch(index, { branch: 'else' }, 'Else', command.else);
    } else if (command.type === 'choice') {
      command.options.forEach((option, i) =>
        branch(index, { branch: 'option', option: i }, `When “${option.label}”`, option.commands),
      );
    } else if (command.type === 'battle') {
      for (const [key, label] of BATTLE_BRANCHES) {
        const list = command[key];
        if (list) branch(index, { branch: key }, label, list);
      }
    }
  });
  rows.push({ kind: 'end', path, index: commands.length, depth });
  return rows;
}

// Descriptions ----------------------------------------------------------------

/** Display names for ids, so command rows read "Turn Met the elder on" instead of ids. */
export interface NameLookup {
  map(id: string): string;
  switchName(id: string): string;
  variable(id: string): string;
  actor(id: string): string;
  item(kind: 'item' | 'equipment', id: string): string;
  troop(id: string): string;
  /** An event on the map being edited (for move routes); ids are shown without one. */
  event?(id: string): string;
}

/** A lookup that shows ids as they are (for tests and fallbacks). */
export const ID_NAMES: NameLookup = {
  map: (id) => id,
  switchName: (id) => id,
  variable: (id) => id,
  actor: (id) => id,
  item: (_, id) => id,
  troop: (id) => id,
};

const VARIABLE_OPS: Record<VariableOp, string> = {
  set: '=',
  add: '+=',
  sub: '−=',
  mul: '×=',
  div: '÷=',
  mod: 'mod=',
};

function operand(value: Operand, names: NameLookup): string {
  return typeof value === 'number' ? String(value) : names.variable(value.variable);
}

function quote(text: string, max = 48): string {
  const line = text.split('\n')[0] ?? '';
  const more = line.length > max || text.includes('\n');
  return `“${line.slice(0, max)}${more ? '…' : ''}”`;
}

const fileName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function describeCondition(condition: Condition, names: NameLookup = ID_NAMES): string {
  switch (condition.type) {
    case 'switch':
      return `${names.switchName(condition.switch)} is ${condition.value ? 'on' : 'off'}`;
    case 'variable':
      return `${names.variable(condition.variable)} ${condition.op} ${condition.value}`;
    case 'gold':
      return `gold ${condition.op} ${condition.value}`;
    case 'hasItem': {
      const count = condition.count ?? 1;
      const what = names.item(condition.kind, condition.id);
      return `has ${count > 1 ? `${count} × ` : ''}${what}${condition.includeEquipped ? ' (worn counts)' : ''}`;
    }
    case 'inParty':
      return `${names.actor(condition.actor)} is in the party`;
    case 'flag':
      return `flag “${condition.flag}” is ${condition.value ? 'on' : 'off'}`;
  }
}

/** One line summarising a command, as shown in the command list. */
export function describeCommand(command: Command, names: NameLookup = ID_NAMES): string {
  switch (command.type) {
    case 'message':
      return `${command.speaker ? `${command.speaker}: ` : 'Message: '}${quote(command.text)}`;
    case 'choice':
      return `Choice: ${command.options.map((o) => o.label).join(' / ')}`;
    case 'if':
      return `If ${command.conditions.map((c) => describeCondition(c, names)).join(' and ')}`;
    case 'setSwitch':
      return `Turn ${names.switchName(command.switch)} ${command.value ? 'on' : 'off'}`;
    case 'setFlag': {
      const whose = command.event
        ? `${names.event?.(command.event) ?? command.event}’s flag`
        : 'flag';
      return `Turn ${whose} “${command.flag}” ${command.value ? 'on' : 'off'}`;
    }
    case 'setVariable':
      return `${names.variable(command.variable)} ${VARIABLE_OPS[command.op]} ${operand(command.value, names)}`;
    case 'transfer':
      return `Transfer to ${names.map(command.map)} (${command.x}, ${command.y})${command.direction ? ` facing ${command.direction}` : ''}`;
    case 'wait':
      return `Wait ${command.seconds} s`;
    case 'changeGold':
      return typeof command.amount === 'number'
        ? `${command.amount < 0 ? 'Lose' : 'Gain'} ${Math.abs(command.amount)} gold`
        : `Change gold by ${operand(command.amount, names)}`;
    case 'changeItems': {
      const what = names.item(command.kind, command.id);
      return typeof command.amount === 'number'
        ? `${command.amount < 0 ? 'Lose' : 'Gain'} ${Math.abs(command.amount)} × ${what}`
        : `Change ${what} by ${operand(command.amount, names)}`;
    }
    case 'changeParty':
      return `${names.actor(command.actor)} ${command.action === 'add' ? 'joins' : 'leaves'} the party`;
    case 'gainExp':
      return `${command.actor ? names.actor(command.actor) : 'Party'} gains ${operand(command.amount, names)} exp`;
    case 'recoverAll':
      return `Fully recover ${command.actor ? names.actor(command.actor) : 'the party'}`;
    case 'battle': {
      const rules = [command.canEscape ? 'can escape' : null, command.canLose ? 'can lose' : null]
        .filter(Boolean)
        .join(', ');
      return `Battle: ${names.troop(command.troop)}${rules ? ` (${rules})` : ''}`;
    }
    case 'playMusic':
      return command.path === null ? 'Stop music' : `Play music ${fileName(command.path)}`;
    case 'playSound':
      return `Play sound ${fileName(command.path)}`;
    case 'shop': {
      const goods = command.goods.map((g) => names.item(g.kind, g.id));
      const shown = goods.length > 3 ? [...goods.slice(0, 3), `+${goods.length - 3} more`] : goods;
      return `Shop: ${shown.join(', ')}${command.canSell ? '' : ' (no selling)'}`;
    }
    case 'moveRoute': {
      const who =
        command.target === 'player'
          ? 'the player'
          : command.target === 'this'
            ? 'this event'
            : (names.event?.(command.target) ?? command.target);
      const how = [
        command.repeat ? 'repeat' : null,
        command.skipBlocked ? 'skip blocked' : null,
        command.wait && !command.repeat ? 'wait' : null,
      ].filter(Boolean);
      return `Move ${who}: ${describeRoute(command.steps)}${how.length > 0 ? ` (${how.join(', ')})` : ''}`;
    }
    case 'comment':
      return `// ${command.text.split('\n')[0] ?? ''}`;
  }
}

const ARROWS: Readonly<Record<string, string>> = {
  down: '↓',
  left: '←',
  right: '→',
  up: '↑',
  forward: 'forward',
  around: 'around',
  random: 'random',
  'toward-player': 'toward player',
  'away-from-player': 'away from player',
};

/** One route step, short: "↑", "turn ←", "wait 1 s", "speed 6". */
export function describeStep(step: MoveStep): string {
  switch (step.type) {
    case 'move':
      return ARROWS[step.direction] ?? step.direction;
    case 'turn':
      return `turn ${ARROWS[step.direction] ?? step.direction}`;
    case 'wait':
      return `wait ${step.seconds} s`;
    case 'speed':
      return `speed ${step.speed}`;
  }
}

/** A route, short: runs of the same step are counted ("↑ ×3, wait 1 s, ←"). */
export function describeRoute(steps: readonly MoveStep[]): string {
  const parts: string[] = [];
  let last: string | null = null;
  let count = 0;
  const flush = () => {
    if (last !== null) parts.push(count > 1 ? `${last} ×${count}` : last);
  };
  for (const step of steps) {
    const text = describeStep(step);
    if (text === last) count++;
    else {
      flush();
      last = text;
      count = 1;
    }
  }
  flush();
  return parts.join(', ') || '(no steps)';
}

/**
 * Every event flag name a map's events use (in page conditions, `if`
 * conditions and setFlag commands), sorted: suggestions for flag fields.
 */
export function mapFlagNames(map: GameMap): string[] {
  const names = new Set<string>();
  const fromConditions = (conditions: readonly Condition[]) => {
    for (const c of conditions) if (c.type === 'flag') names.add(c.flag);
  };
  for (const event of map.events) {
    for (const page of event.pages) {
      fromConditions(page.conditions);
      walkCommands(page.commands, (command) => {
        if (command.type === 'setFlag') names.add(command.flag);
        else if (command.type === 'if') fromConditions(command.conditions);
      });
    }
  }
  return [...names].sort();
}

/** Command types in the order (and groups) the "add command" menu offers them. */
export const COMMAND_GROUPS: readonly {
  readonly label: string;
  readonly types: readonly Command['type'][];
}[] = [
  { label: 'Messages', types: ['message', 'choice', 'comment'] },
  { label: 'Flow', types: ['if', 'wait'] },
  { label: 'Game state', types: ['setSwitch', 'setVariable', 'setFlag'] },
  {
    label: 'Party',
    types: ['changeGold', 'changeItems', 'shop', 'changeParty', 'gainExp', 'recoverAll'],
  },
  { label: 'World', types: ['transfer', 'moveRoute', 'battle'] },
  { label: 'Audio', types: ['playMusic', 'playSound'] },
];

export const COMMAND_NAMES: Record<Command['type'], string> = {
  message: 'Show message',
  choice: 'Show choices',
  comment: 'Comment',
  if: 'If…',
  wait: 'Wait',
  setSwitch: 'Set switch',
  setVariable: 'Set variable',
  setFlag: 'Set event flag',
  changeGold: 'Change gold',
  changeItems: 'Change items',
  changeParty: 'Change party',
  gainExp: 'Give experience',
  recoverAll: 'Recover all',
  transfer: 'Transfer player',
  moveRoute: 'Move route',
  shop: 'Open shop',
  battle: 'Start battle',
  playMusic: 'Play music',
  playSound: 'Play sound',
};

// Document wrappers ---------------------------------------------------------

/** Change one map through a pure map edit, as one undo step. */
export function editMap(
  doc: ProjectDocument,
  path: string,
  label: string,
  change: (map: GameMap) => GameMap,
  options: EditOptions = {},
): boolean {
  return doc.update(path, 'map', label, change, options);
}
