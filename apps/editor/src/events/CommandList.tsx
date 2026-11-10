import {
  COMMAND_GROUPS,
  COMMAND_NAMES,
  COMMAND_SCHEMAS,
  type CommandRow,
  type ListPath,
  type NameLookup,
  defaultFor,
  describeCommand,
  flattenCommands,
  getList,
} from '@freequest/editor-core';
import type { Command, CommandType } from '@freequest/schema';
import { useState } from 'react';
import type { FormContext } from '../forms/SchemaField.js';
import { ValueDialog } from './ValueDialog.js';
import { commandProblem } from './validate.js';

/** A command, or the end slot of a list: where the next added command goes. */
export interface Slot {
  readonly path: ListPath;
  readonly index: number;
}

export interface CommandActions {
  insert(slot: Slot, command: Command): void;
  replace(slot: Slot, command: Command): void;
  remove(slot: Slot): void;
  move(slot: Slot, delta: number): void;
}

interface Props {
  readonly commands: readonly Command[];
  readonly ctx: FormContext;
  readonly names: NameLookup;
  readonly actions: CommandActions;
}

const samePath = (a: ListPath, b: ListPath) =>
  a.length === b.length &&
  a.every(
    (s, i) => s.index === b[i]?.index && s.branch === b[i]?.branch && s.option === b[i]?.option,
  );
const sameSlot = (a: Slot | null, b: Slot) =>
  !!a && a.index === b.index && samePath(a.path, b.path);

type Editing =
  | { readonly mode: 'add'; readonly slot: Slot; readonly command: Command }
  | { readonly mode: 'edit'; readonly slot: Slot; readonly command: Command };

/**
 * The command tree of one page as an indented list. Select a row (a command
 * or a list's end slot) and add, edit, delete or move from the toolbar, by
 * double-click, or with the keyboard (Enter edits, Delete removes, Alt+↑/↓
 * moves, Insert adds).
 */
export function CommandList({ commands, ctx, names, actions }: Props) {
  const rows = flattenCommands(commands);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState<Editing | null>(null);

  // A selection the tree no longer has (after undo, say) falls back to the end.
  const valid =
    selected && rows.some((r) => r.kind !== 'branch' && sameSlot(selected, r)) ? selected : null;
  const slot: Slot = valid ?? { path: [], index: commands.length };
  const current = (() => {
    try {
      return getList(commands, slot.path)[slot.index] ?? null;
    } catch {
      return null;
    }
  })();

  const add = (type: CommandType) => {
    setMenu(false);
    const schema = COMMAND_SCHEMAS.get(type);
    if (!schema) return;
    setEditing({ mode: 'add', slot, command: defaultFor(schema, ctx.pick) as Command });
  };
  const edit = () => current && setEditing({ mode: 'edit', slot, command: current });
  const remove = () => {
    if (!current) return;
    actions.remove(slot);
  };
  const move = (delta: number) => {
    if (!current) return;
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
          onClick={() => move(-1)}
          disabled={!current}
          title="Move up (Alt+↑)"
          aria-label="Move up"
        >
          ↑
        </button>
        <button
          onClick={() => move(1)}
          disabled={!current}
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
          if (key === 'Enter') edit();
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
          const isSelected = sameSlot(slot, row);
          const select = () => setSelected({ path: row.path, index: row.index });
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
          onClose={() => setEditing(null)}
          onOk={(command) => {
            if (editing.mode === 'add') {
              actions.insert(editing.slot, command);
              setSelected({ path: editing.slot.path, index: editing.slot.index + 1 });
            } else actions.replace(editing.slot, command);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}
