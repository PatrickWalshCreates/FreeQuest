import {
  CONDITION_SCHEMA,
  type ProjectDocument,
  addPage,
  defaultFor,
  describeCondition,
  duplicatePage,
  editMap,
  clipboard,
  insertCommands,
  pasteEvent,
  moveCommand,
  movePage,
  removeCommands,
  removeEvent,
  removePage,
  replaceCommand,
  updateEvent,
  updatePage,
} from '@freequest/editor-core';
import type {
  Condition,
  EventLayer,
  EventPage,
  EventTrigger,
  GameMap,
  MapEvent,
} from '@freequest/schema';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { projectFormContext, projectNames } from '../forms/project-context.js';
import { useProjectLists } from '../forms/use-project-lists.js';
import { type CommandActions, CommandList } from './CommandList.js';
import { TransferTargetButton } from './TransferTargetButton.js';
import { ValueDialog } from './ValueDialog.js';
import { conditionProblem } from './validate.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly path: string;
  readonly map: GameMap;
  readonly selected: string | null;
  readonly onSelect: (id: string | null) => void;
}

const TRIGGERS: readonly { value: EventTrigger; label: string }[] = [
  { value: 'action', label: 'Talk / examine (confirm)' },
  { value: 'touch', label: 'Touch (step on or bump)' },
  { value: 'autorun', label: 'Autorun (when the page is active)' },
  { value: 'parallel', label: 'Parallel (runs alongside play, again and again)' },
];

const LAYERS: readonly { value: EventLayer; label: string }[] = [
  { value: 'same', label: 'Same as characters (blocks)' },
  { value: 'below', label: 'Below characters' },
  { value: 'above', label: 'Above characters' },
];

const CONDITION_NAMES: Record<string, string> = {
  switch: 'Switch',
  variable: 'Variable',
  gold: 'Gold',
  hasItem: 'Has item',
  inParty: 'In party',
};

const subscribeClipboard = (listener: () => void) => clipboard.subscribe(listener);

/** True while the clipboard holds an event (re-renders when it changes). */
export function useClipboardHasEvent(): boolean {
  useSyncExternalStore(subscribeClipboard, () => clipboard.version);
  return clipboard.content?.kind === 'event';
}

/**
 * Paste the clipboard's event onto the map at the free cell nearest (x, y).
 * Returns its new id, or null when there's nothing to paste or no free cell.
 */
export function pasteEventAt(
  doc: ProjectDocument,
  path: string,
  x: number,
  y: number,
): string | null {
  const event = clipboard.event();
  if (!event) return null;
  let id: string | null = null;
  try {
    editMap(doc, path, 'Paste event', (m) => {
      const result = pasteEvent(m, event, x, y);
      id = result.id;
      return result.map;
    });
  } catch {
    return null;
  }
  return id;
}

/** The selected event's editor, and the list of the map's events. */
export function EventPanel({ doc, path, map, selected, onSelect }: Props) {
  const event = map.events.find((e) => e.id === selected) ?? null;
  const canPaste = useClipboardHasEvent();
  const paste = () => {
    const at = event ?? { x: Math.floor(map.width / 2), y: Math.floor(map.height / 2) };
    const id = pasteEventAt(doc, path, at.x, at.y);
    if (id) onSelect(id);
  };
  return (
    <div className="event-panel">
      <section>
        <h2 className="with-actions">
          Events on this map
          <button
            className="small"
            disabled={!canPaste}
            title={
              canPaste
                ? 'Paste the copied event next to the selected one (or ⌘V on the map, where the pointer is)'
                : 'Copy an event first'
            }
            onClick={paste}
          >
            Paste
          </button>
        </h2>
        {map.events.length === 0 ? (
          <p className="hint">Double-click an empty cell to add an event.</p>
        ) : (
          <ul className="event-list">
            {map.events.map((e) => (
              <li key={e.id}>
                <button
                  className={e.id === selected ? 'item selected' : 'item'}
                  onClick={() => onSelect(e.id)}
                >
                  <span>{e.name}</span>
                  <span className="muted">
                    {e.x}, {e.y}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {event ? (
        <EventEditor key={event.id} doc={doc} path={path} event={event} onSelect={onSelect} />
      ) : (
        <p className="hint">
          Click an event on the map to edit it; drag to move it. Double-click an empty cell to add
          one.
        </p>
      )}
    </div>
  );
}

function EventEditor(props: {
  readonly doc: ProjectDocument;
  readonly path: string;
  readonly event: MapEvent;
  readonly onSelect: (id: string | null) => void;
}) {
  const { doc, path, event, onSelect } = props;
  const [pageIndex, setPageIndex] = useState(0);
  const page = event.pages[Math.min(pageIndex, event.pages.length - 1)] ?? event.pages[0];
  const shownPage = Math.min(pageIndex, event.pages.length - 1);
  const { audio } = useProjectLists(doc);
  const project = doc.project;
  const ctx = useMemo(() => projectFormContext(project, { audio }), [project, audio]);
  const names = useMemo(() => projectNames(project), [project]);

  const changeEvent = (label: string, fn: (e: MapEvent) => MapEvent, coalesce?: string) =>
    editMap(doc, path, label, (m) => updateEvent(m, event.id, fn), coalesce ? { coalesce } : {});
  const changePage = (label: string, fn: (p: EventPage) => EventPage) =>
    editMap(doc, path, label, (m) => updatePage(m, event.id, shownPage, fn));
  const commands: CommandActions = {
    insert: (slot, inserted, label) =>
      changePage(label, (p) => ({
        ...p,
        commands: insertCommands(p.commands, slot.path, slot.index, inserted),
      })),
    replace: (slot, command) =>
      changePage('Edit command', (p) => ({
        ...p,
        commands: replaceCommand(p.commands, slot.path, slot.index, command),
      })),
    remove: (slot, count, label) =>
      changePage(label, (p) => ({
        ...p,
        commands: removeCommands(p.commands, slot.path, slot.index, count),
      })),
    move: (slot, delta) =>
      changePage('Move command', (p) => ({
        ...p,
        commands: moveCommand(p.commands, slot.path, slot.index, delta),
      })),
  };
  const [editingCondition, setEditingCondition] = useState<{
    readonly index: number | null;
    readonly value: Condition;
  } | null>(null);
  const characters = [...project.characters];

  if (!page) return null;
  return (
    <section className="event-editor">
      <div className="event-header">
        <label className="field grow">
          <span>Event name</span>
          <input
            value={event.name}
            onChange={(e) => {
              const name = e.target.value;
              changeEvent('Rename event', (ev) => ({ ...ev, name }), `event-name:${event.id}`);
            }}
            onBlur={() => doc.endCoalescing()}
          />
        </label>
        <button
          title="Copy this event, all pages included (⌘C on the map)"
          onClick={() => clipboard.set({ kind: 'event', event })}
        >
          Copy
        </button>
        <button
          className="danger"
          title="Delete this event (Delete key on the map)"
          onClick={() => {
            editMap(doc, path, 'Delete event', (m) => removeEvent(m, event.id));
            onSelect(null);
          }}
        >
          Delete
        </button>
      </div>
      <p className="hint">
        Id <code>{event.id}</code> at {event.x}, {event.y}. When several pages’ conditions hold, the
        last one is used.
      </p>

      <div className="page-tabs" role="tablist" aria-label="Pages">
        {event.pages.map((_, i) => (
          <button
            key={i}
            role="tab"
            aria-selected={i === shownPage}
            className={i === shownPage ? 'on' : undefined}
            onClick={() => setPageIndex(i)}
          >
            {i + 1}
          </button>
        ))}
        <span className="spacer" />
        <button
          title="Add a page"
          onClick={() => {
            changeEvent('Add page', addPage);
            setPageIndex(event.pages.length);
          }}
        >
          + Page
        </button>
        <button
          title="Copy this page"
          onClick={() => {
            changeEvent('Copy page', (e) => duplicatePage(e, shownPage));
            setPageIndex(shownPage + 1);
          }}
        >
          Copy
        </button>
        <button
          title="Move this page earlier"
          aria-label="Move page earlier"
          disabled={shownPage === 0}
          onClick={() => {
            changeEvent('Move page', (e) => movePage(e, shownPage, -1));
            setPageIndex(shownPage - 1);
          }}
        >
          ←
        </button>
        <button
          title="Move this page later"
          aria-label="Move page later"
          disabled={shownPage === event.pages.length - 1}
          onClick={() => {
            changeEvent('Move page', (e) => movePage(e, shownPage, 1));
            setPageIndex(shownPage + 1);
          }}
        >
          →
        </button>
        <button
          className="danger"
          title="Delete this page"
          disabled={event.pages.length === 1}
          onClick={() => {
            changeEvent('Delete page', (e) => removePage(e, shownPage));
            setPageIndex(Math.max(0, shownPage - 1));
          }}
        >
          Delete
        </button>
      </div>

      <div className="page-settings">
        <label className="field">
          <span>Starts when</span>
          <select
            value={page.trigger}
            onChange={(e) =>
              changePage('Change trigger', (p) => ({
                ...p,
                trigger: e.target.value as EventTrigger,
              }))
            }
          >
            {TRIGGERS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Drawn</span>
          <select
            value={page.layer}
            onChange={(e) =>
              changePage('Change layer', (p) => ({ ...p, layer: e.target.value as EventLayer }))
            }
          >
            {LAYERS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <div className="row">
          <label className="field grow">
            <span>Graphic</span>
            <select
              value={page.graphic?.character ?? ''}
              onChange={(e) => {
                const character = e.target.value;
                changePage('Change graphic', (p) => {
                  const { graphic: old, ...rest } = p;
                  return character
                    ? { ...rest, graphic: { character, direction: old?.direction ?? 'down' } }
                    : rest;
                });
              }}
            >
              <option value="">(invisible)</option>
              {characters.map(([id, file]) => (
                <option key={id} value={id}>
                  {file.data?.name ?? id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Facing</span>
            <select
              value={page.graphic?.direction ?? 'down'}
              disabled={!page.graphic}
              onChange={(e) => {
                const direction = e.target.value as 'down' | 'left' | 'right' | 'up';
                changePage('Change facing', (p) =>
                  p.graphic ? { ...p, graphic: { ...p.graphic, direction } } : p,
                );
              }}
            >
              {(['down', 'left', 'right', 'up'] as const).map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <h3>Conditions</h3>
      {page.conditions.length === 0 ? (
        <p className="hint">Always active (no conditions).</p>
      ) : (
        <ul className="conditions">
          {page.conditions.map((c, i) => (
            <li key={i}>
              <button
                className="link-row"
                onClick={() => setEditingCondition({ index: i, value: c })}
                title="Edit this condition"
              >
                {describeCondition(c, names)}
              </button>
              <button
                className="icon"
                aria-label="Remove condition"
                onClick={() =>
                  changePage('Remove condition', (p) => ({
                    ...p,
                    conditions: p.conditions.filter((_, j) => j !== i),
                  }))
                }
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="small"
        onClick={() =>
          setEditingCondition({
            index: null,
            value: defaultFor(CONDITION_SCHEMA, ctx.pick) as Condition,
          })
        }
      >
        + Condition
      </button>

      <h3>Commands</h3>
      <CommandList
        key={shownPage}
        commands={page.commands}
        ctx={ctx}
        names={names}
        actions={commands}
        extra={(command, setCommand) =>
          command.type === 'transfer' ? (
            <TransferTargetButton doc={doc} command={command} onChange={setCommand} />
          ) : null
        }
      />

      {editingCondition && (
        <ValueDialog
          title={editingCondition.index === null ? 'Add condition' : 'Edit condition'}
          schema={CONDITION_SCHEMA}
          initial={editingCondition.value}
          ctx={ctx}
          validate={conditionProblem}
          variantName={(label) => CONDITION_NAMES[label] ?? label}
          okLabel={editingCondition.index === null ? 'Add' : 'Save'}
          onClose={() => setEditingCondition(null)}
          onOk={(condition) => {
            const index = editingCondition.index;
            changePage(index === null ? 'Add condition' : 'Edit condition', (p) => ({
              ...p,
              conditions:
                index === null
                  ? [...p.conditions, condition]
                  : p.conditions.map((c, j) => (j === index ? condition : c)),
            }));
            setEditingCondition(null);
          }}
        />
      )}
    </section>
  );
}
