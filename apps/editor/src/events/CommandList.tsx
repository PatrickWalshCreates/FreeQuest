import {
  COMMAND_GROUPS,
  COMMAND_NAMES,
  COMMAND_SCHEMAS,
  type CommandRow,
  type ListPath,
  type NameLookup,
  clipboard,
  commandHasFields,
  defaultFor,
  describeCommand,
  flattenCommands,
  getList,
  insertCommands,
  moveCommand,
  removeCommands,
  replaceCommand,
  sliceCommands,
} from '@freequest/editor-core';
import type { Command, CommandType } from '@freequest/schema';
import { type ReactNode, useState, useSyncExternalStore } from 'react';
import type { FormContext } from '../forms/SchemaField.js';
import { ValueDialog } from './ValueDialog.js';
import { commandProblem } from './validate.js';
import { MOD } from '../keys.js';

/** A command, or the end slot of a list: where the next added command goes. */
export interface Slot {
  readonly path: ListPath;
  readonly index: number;
}

export interface CommandActions {
  insert(slot: Slot, commands: readonly Command[], label: string): void;
  replace(slot: Slot, command: Command): void;
  /** Remove `count` commands from the slot on. */
  remove(slot: Slot, count: number, label: string): void;
  move(slot: Slot, delta: number): void;
}

/**
 * The actions for a command list kept somewhere in the document: `change`
 * applies an edit of the whole list as one undo step.
 */
export function listActions(
  change: (label: string, edit: (commands: readonly Command[]) => Command[]) => void,
): CommandActions {
  return {
    insert: (slot, inserted, label) =>
      change(label, (c) => insertCommands(c, slot.path, slot.index, inserted)),
    replace: (slot, command) =>
      change('Edit command', (c) => replaceCommand(c, slot.path, slot.index, command)),
    remove: (slot, count, label) =>
      change(label, (c) => removeCommands(c, slot.path, slot.index, count)),
    move: (slot, delta) =>
      change('Move command', (c) => moveCommand(c, slot.path, slot.index, delta)),
  };
}

const subscribeClipboard = (listener: () => void) => clipboard.subscribe(listener);
/** The number of commands on the clipboard (0 when it holds something else). */
function useClipboardCommands(): number {
  useSyncExternalStore(subscribeClipboard, () => clipboard.version);
  return clipboard.content?.kind === 'commands' ? clipboard.content.commands.length : 0;
}

interface Props {
  readonly commands: readonly Command[];
  readonly ctx: FormContext;
  readonly names: NameLookup;
  readonly actions: CommandActions;
  /** More controls in a command's dialog (e.g. a map picker for transfers). */
  readonly extra?: (command: Command, setCommand: (command: Command) => void) => ReactNode;
}

const samePath = (a: ListPath, b: ListPath) =>
  a.length === b.length &&
  a.every(
    (s, i) => s.index === b[i]?.index && s.branch === b[i]?.branch && s.option === b[i]?.option,
  );
const sameSlot = (a: Slot | null, b: Slot) =>
  !!a && a.index === b.index && samePath(a.path, b.path);
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

type Editing =
  | { readonly mode: 'add'; readonly slot: Slot; readonly command: Command }
  | { readonly mode: 'edit'; readonly slot: Slot; readonly command: Command };

/**
 * The command tree of one page as an indented list. Select a row (a command
 * or a list's end slot) and add, edit, delete or move from the toolbar, by
 * double-click, or with the keyboard (Enter edits, Delete removes, Alt+↑/↓
 * moves, Insert adds). Shift+click or Shift+↑/↓ selects a run of commands in
 * one list, for ⌘C / ⌘X / ⌘V (the clipboard outlives the project).
 */
export function CommandList({ commands, ctx, names, actions, extra }: Props) {
  const rows = flattenCommands(commands);
  const [selected, setSelectedSlot] = useState<Slot | null>(null);
  /** The other end of a Shift-selected run, in the same list as `selected`. */
  const [anchor, setAnchor] = useState<number | null>(null);
  const setSelected = (next: Slot | null) => {
    setSelectedSlot(next);
    setAnchor(null);
  };
  const onClipboard = useClipboardCommands();
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);

  // A selection the tree no longer has (after undo, say) falls back to the end.
  const valid =
    selected && rows.some((r) => r.kind !== 'branch' && sameSlot(selected, r)) ? selected : null;
  const slot: Slot = valid ?? { path: [], index: commands.length };
  const list = (() => {
    try {
      return getList(commands, slot.path);
    } catch {
      return [];
    }
  })();
  const current = list[slot.index] ?? null;
  // The selected run: from the anchor to the selection, commands only (never the end slot).
  const run = (() => {
    if (!current) return { start: slot.index, count: 0 };
    if (anchor === null || anchor >= list.length) return { start: slot.index, count: 1 };
    const start = Math.min(anchor, slot.index);
    return { start, count: Math.abs(anchor - slot.index) + 1 };
  })();
  const inRun = (row: Slot) =>
    samePath(row.path, slot.path) && row.index >= run.start && row.index < run.start + run.count;
  const runSlot: Slot = { path: slot.path, index: run.start };

  const copy = () => {
    if (run.count === 0) return;
    clipboard.set({
      kind: 'commands',
      commands: sliceCommands(commands, slot.path, run.start, run.count),
    });
  };
  const cut = () => {
    if (run.count === 0) return;
    copy();
    actions.remove(runSlot, run.count, run.count === 1 ? 'Cut command' : 'Cut commands');
    setSelected(runSlot);
  };
  const paste = () => {
    const pasted = clipboard.commands();
    if (!pasted || pasted.length === 0) return;
    actions.insert(slot, pasted, pasted.length === 1 ? 'Paste command' : 'Paste commands');
    setSelectedSlot({ path: slot.path, index: slot.index + pasted.length - 1 });
    setAnchor(pasted.length > 1 ? slot.index : null);
  };
  /** Extend the run to `index` in the same list (Shift+click, Shift+arrows). */
  const extendTo = (index: number) => {
    if (!current || index < 0 || index >= list.length) return;
    setAnchor(anchor ?? slot.index);
    setSelectedSlot({ path: slot.path, index });
  };

  const add = (type: CommandType) => {
    setMenu(false);
    const schema = COMMAND_SCHEMAS.get(type);
    if (!schema) return;
    const command = defaultFor(schema, ctx.pick) as Command;
    // Nothing to fill in (Loop, Break loop, Exit event): add it without a dialog.
    if (!commandHasFields(type)) {
      actions.insert(slot, [command], 'Add command');
      return;
    }
    setEditing({ mode: 'add', slot, command });
  };
  const edit = () => current && setEditing({ mode: 'edit', slot, command: current });
  const remove = () => {
    if (run.count === 0) return;
    actions.remove(runSlot, run.count, run.count === 1 ? 'Delete command' : 'Delete commands');
    setSelected(runSlot);
  };
  const move = (delta: number) => {
    if (!current || run.count > 1) return;
    const length = getList(commands, slot.path).length;
    const target = slot.index + delta;
    if (target < 0 || target >= length) return;
    actions.move(slot, delta);
    setSelected({ path: slot.path, index: target });
  };

  return (
    <div className="commands">
      <div className="command-toolbar">
        <div className="menu-anchor">
          <button className="primary small" onClick={() => setMenu((v) => !v)} aria-expanded={menu}>
            + Add
          </button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => setMenu(false)}>
              {COMMAND_GROUPS.map((group) => (
                <div key={group.label} className="menu-group">
                  <div className="menu-heading">{group.label}</div>
                  {group.types.map((type) => (
                    <button key={type} role="menuitem" onClick={() => add(type)}>
                      {COMMAND_NAMES[type]}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={edit} disabled={!current} title="Edit (Enter or double-click)">
          Edit
        </button>
        <button onClick={remove} disabled={!current} title="Delete (Delete key)">
          Delete
        </button>
        <button
          onClick={copy}
          disabled={!current}
          title={`Copy ${run.count > 1 ? plural(run.count, 'command') : 'the command'} (${MOD}C)`}
        >
          Copy
        </button>
        <button
          onClick={paste}
          disabled={onClipboard === 0}
          title={
            onClipboard > 0
              ? `Paste ${plural(onClipboard, 'command')} before the selection (${MOD}V)`
              : 'Copy commands first'
          }
        >
          Paste
        </button>
        <button
          onClick={() => move(-1)}
          disabled={!current || run.count > 1}
          title="Move up (Alt+↑)"
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          onClick={() => move(1)}
          disabled={!current || run.count > 1}
          title="Move down (Alt+↓)"
          aria-label="Move down"
        >
          ↓
        </button>
      </div>
      <ol
        className="command-rows"
        tabIndex={0}
        aria-label="Commands"
        onKeyDown={(event) => {
          const key = event.key;
          const mod = event.metaKey || event.ctrlKey;
          if (mod && key.toLowerCase() === 'c') copy();
          else if (mod && key.toLowerCase() === 'x') cut();
          else if (mod && key.toLowerCase() === 'v') paste();
          else if (mod) return;
          else if (event.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
            extendTo(slot.index + (key === 'ArrowUp' ? -1 : 1));
          } else if (key === 'Enter') edit();
          else if (key === 'Delete' || key === 'Backspace') remove();
          else if (key === 'Insert') setMenu(true);
          else if (event.altKey && key === 'ArrowUp') move(-1);
          else if (event.altKey && key === 'ArrowDown') move(1);
          else if (key === 'ArrowUp' || key === 'ArrowDown') {
            const slots = rows.filter(
              (r): r is Exclude<CommandRow, { kind: 'branch' }> => r.kind !== 'branch',
            );
            const at = slots.findIndex((r) => sameSlot(slot, r));
            const next = slots[at + (key === 'ArrowUp' ? -1 : 1)];
            if (next) setSelected({ path: next.path, index: next.index });
          } else return;
          event.preventDefault();
          event.stopPropagation();
        }}
      >
        {rows.map((row, i) => {
          const indent = { paddingLeft: 8 + row.depth * 16 };
          if (row.kind === 'branch') {
            return (
              <li key={i} className="command-branch" style={indent}>
                {row.label}
              </li>
            );
          }
          const isSelected = row.kind === 'command' ? inRun(row) : sameSlot(slot, row);
          const select = (event: React.MouseEvent) => {
            if (
              event.shiftKey &&
              row.kind === 'command' &&
              current &&
              samePath(row.path, slot.path)
            ) {
              extendTo(row.index);
            } else setSelected({ path: row.path, index: row.index });
          };
          if (row.kind === 'end') {
            return (
              <li
                key={i}
                className={isSelected ? 'command-end selected' : 'command-end'}
                style={indent}
                onClick={select}
                onDoubleClick={() => setMenu(true)}
              >
                ◇
              </li>
            );
          }
          return (
            <li
              key={i}
              className={`command-row type-${row.command.type}${isSelected ? ' selected' : ''}`}
              style={indent}
              onClick={select}
              onDoubleClick={() => setEditing({ mode: 'edit', slot: row, command: row.command })}
            >
              {describeCommand(row.command, names)}
            </li>
          );
        })}
      </ol>
      {editing && (
        <ValueDialog
          title={`${editing.mode === 'add' ? 'Add' : 'Edit'}: ${COMMAND_NAMES[editing.command.type]}`}
          schema={COMMAND_SCHEMAS.get(editing.command.type) ?? {}}
          initial={editing.command}
          ctx={ctx}
          validate={commandProblem}
          okLabel={editing.mode === 'add' ? 'Add' : 'Save'}
          {...(extra ? { extra } : {})}
          onClose={() => setEditing(null)}
          onOk={(command) => {
            if (editing.mode === 'add') {
              actions.insert(editing.slot, [command], 'Add command');
              setSelected({ path: editing.slot.path, index: editing.slot.index + 1 });
            } else actions.replace(editing.slot, command);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
