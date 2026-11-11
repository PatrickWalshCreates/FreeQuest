import {
  type Entry,
  type EntryKind,
  type ProjectDocument,
  type ProjectFile,
  addEntry,
  clipboard,
  duplicateEntry,
  entrySchema,
  idProblem,
  moveEntry,
  newEntry,
  pasteEntry,
  removeEntry,
  replaceEntry,
  slugify,
  uniqueId,
} from '@freequest/editor-core';
import { type DatabaseKind, SCHEMAS } from '@freequest/schema';
import { useMemo, useState, useSyncExternalStore } from 'react';
import { Dialog, Field } from '../Dialog.js';
import { type FormContext, ObjectFields } from '../forms/SchemaField.js';
import { projectFormContext } from '../forms/project-context.js';
import { useProjectLists } from '../forms/use-project-lists.js';
import { useLoaded } from '../map/graphics.js';
import { confirmAction } from '../platform.js';

const subscribeClipboard = (listener: () => void) => clipboard.subscribe(listener);
const MOD = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

interface Props {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<DatabaseKind>;
}

const SINGULAR: Record<EntryKind, string> = {
  actors: 'actor',
  classes: 'class',
  skills: 'skill',
  items: 'item',
  equipment: 'equipment',
  states: 'state',
  enemies: 'enemy',
  troops: 'troop',
};

type EntriesData = { readonly formatVersion: number; readonly entries: readonly Entry[] };

/** Edits one database file: system.json as one form, other categories as a list of entries. */
export function DatabaseEditor({ doc, file }: Props) {
  const lists = useProjectLists(doc);
  const project = doc.project;
  const ctx = useMemo(() => projectFormContext(project, lists), [project, lists]);
  if (!file.data) return <p className="error">This file could not be loaded.</p>;
  return file.kind === 'system' ? (
    <SystemEditor doc={doc} file={file} ctx={ctx} />
  ) : (
    <EntriesEditor doc={doc} file={file} kind={file.kind as EntryKind} ctx={ctx} />
  );
}

/** Editing a form changes the document as you type; leaving a field closes the undo step. */
function useEditor(doc: ProjectDocument, file: ProjectFile<DatabaseKind>) {
  return (label: string, change: (data: never) => unknown, coalesce?: string) =>
    doc.update(
      file.path,
      file.kind,
      label,
      change as (data: unknown) => never,
      coalesce ? { coalesce } : {},
    );
}

function SystemEditor(props: {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<DatabaseKind>;
  readonly ctx: FormContext;
}) {
  const { doc, file, ctx } = props;
  const edit = useEditor(doc, file);
  const problems = doc.project.problems.filter(
    (p) => p.source === file.path || p.message.startsWith('system'),
  );
  return (
    <div className="db-single" onBlur={() => doc.endCoalescing()}>
      <h1>System</h1>
      <p className="hint">
        Elements, equipment slots and types, skill types, the system skills, and the music and
        sounds of the engine’s own screens.
      </p>
      <Problems messages={problems.map((p) => p.message)} />
      <ObjectFields
        schema={SCHEMAS.system as never}
        value={file.data as Readonly<Record<string, unknown>>}
        ctx={ctx}
        onChange={(next) => edit('Edit system', () => next as never, `db:${file.path}`)}
      />
    </div>
  );
}

function EntriesEditor(props: {
  readonly doc: ProjectDocument;
  readonly file: ProjectFile<DatabaseKind>;
  readonly kind: EntryKind;
  readonly ctx: FormContext;
}) {
  const { doc, file, kind, ctx } = props;
  const data = file.data as EntriesData;
  const edit = useEditor(doc, file);
  const [selected, setSelected] = useState<string | null>(data.entries[0]?.id ?? null);
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const entry = data.entries.find((e) => e.id === selected) ?? null;
  const singular = SINGULAR[kind];
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? data.entries.filter((e) => `${e.name} ${e.id}`.toLowerCase().includes(needle))
    : data.entries;
  const prefix = `${kind} "`;
  const problemsFor = (id: string) =>
    doc.project.problems
      .filter((p) => p.message.startsWith(`${prefix}${id}"`))
      .map((p) =>
        p.message
          .slice(prefix.length + id.length + 1)
          .replace(/^:\s*/, '')
          .trim(),
      );

  useSyncExternalStore(subscribeClipboard, () => clipboard.version);
  const copied = clipboard.content;
  const canPaste = copied?.kind === 'entry' && copied.category === kind;
  const copy = () => entry && clipboard.set({ kind: 'entry', category: kind, entry });
  const paste = () => {
    const pasted = clipboard.entry(kind);
    if (!pasted) return;
    let id: string | null = null;
    edit(`Paste ${singular}`, (d: EntriesData) => {
      const result = pasteEntry(d, pasted, entry?.id);
      id = result.id;
      return result.file as never;
    });
    setSelected(id);
  };

  const remove = async () => {
    if (!entry) return;
    const ok = await confirmAction(
      `Delete the ${singular} "${entry.name}"? Anything that uses it will show a problem until you change it. You can undo this.`,
      { title: `Delete ${singular}`, okLabel: 'Delete' },
    );
    if (!ok) return;
    const index = data.entries.indexOf(entry);
    edit(`Delete ${singular}`, (d: EntriesData) => removeEntry(d, entry.id) as never);
    const next = data.entries[index + 1] ?? data.entries[index - 1];
    setSelected(next && next.id !== entry.id ? next.id : null);
  };

  return (
    <div className="db-editor">
      <div className="db-list">
        <div className="db-list-tools">
          <input
            type="search"
            placeholder={`Search ${kind}`}
            value={filter}
            aria-label={`Search ${kind}`}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="primary small" onClick={() => setCreating(true)}>
            + New
          </button>
        </div>
        <ul
          aria-label={kind}
          onKeyDown={(event) => {
            if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
            const key = event.key.toLowerCase();
            if (key === 'c') copy();
            else if (key === 'v') paste();
            else return;
            event.preventDefault();
          }}
        >
          {shown.map((e) => (
            <li key={e.id}>
              <button
                className={e.id === selected ? 'item selected' : 'item'}
                onClick={() => setSelected(e.id)}
              >
                <span>{e.name}</span>
                {problemsFor(e.id).length > 0 && (
                  <span className="badge">{problemsFor(e.id).length}</span>
                )}
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <li className="hint">
              {data.entries.length === 0 ? `No ${kind} yet.` : 'No matches.'}
            </li>
          )}
        </ul>
        <div className="db-list-actions">
          <button
            disabled={!entry}
            onClick={() => {
              if (!entry) return;
              let copy: string | null = null;
              edit(`Duplicate ${singular}`, (d: EntriesData) => {
                const result = duplicateEntry(d, entry.id);
                copy = result.id;
                return result.file as never;
              });
              setSelected(copy);
            }}
          >
            Duplicate
          </button>
          <button
            disabled={!entry}
            title={`Copy this ${singular}, to paste here or in another project (${MOD}C)`}
            onClick={copy}
          >
            Copy
          </button>
          <button
            disabled={!canPaste}
            title={
              canPaste
                ? `Paste the copied ${singular} after the selected one (${MOD}V)`
                : `Copy a ${singular} first`
            }
            onClick={paste}
          >
            Paste
          </button>
          <button className="danger" disabled={!entry} onClick={() => void remove()}>
            Delete…
          </button>
          <span className="spacer" />
          <button
            disabled={!entry || data.entries[0] === entry}
            aria-label="Move up"
            title="Move up the list"
            onClick={() =>
              entry &&
              edit(`Move ${singular}`, (d: EntriesData) => moveEntry(d, entry.id, -1) as never)
            }
          >
            ↑
          </button>
          <button
            disabled={!entry || data.entries.at(-1) === entry}
            aria-label="Move down"
            title="Move down the list"
            onClick={() =>
              entry &&
              edit(`Move ${singular}`, (d: EntriesData) => moveEntry(d, entry.id, 1) as never)
            }
          >
            ↓
          </button>
        </div>
      </div>

      <div className="db-form" onBlur={() => doc.endCoalescing()}>
        {entry ? (
          <>
            <div className="db-form-header">
              <EntryImage doc={doc} entry={entry} />
              <div>
                <h1>{entry.name}</h1>
                <p className="hint">
                  {singular} id <code>{entry.id}</code> (used by events and other entries; fixed
                  once created)
                </p>
              </div>
            </div>
            <Problems messages={problemsFor(entry.id)} />
            <ObjectFields
              key={entry.id}
              schema={entrySchema(kind)}
              value={entry as unknown as Readonly<Record<string, unknown>>}
              omit={['id']}
              ctx={ctx}
              onChange={(next) =>
                edit(
                  `Edit ${singular}`,
                  (d: EntriesData) => replaceEntry(d, entry.id, next as unknown as Entry) as never,
                  `db:${file.path}:${entry.id}`,
                )
              }
            />
          </>
        ) : (
          <p className="hint">Select an entry, or add one with + New.</p>
        )}
      </div>

      {creating && (
        <NewEntryDialog
          kind={kind}
          data={data}
          onClose={() => setCreating(false)}
          onCreate={(id, name) => {
            edit(
              `New ${singular}`,
              (d: EntriesData) =>
                addEntry(d, newEntry(kind, id, name, ctx.pick), entry?.id) as never,
            );
            setSelected(id);
            setCreating(false);
          }}
        />
      )}
    </div>
  );
}

function NewEntryDialog(props: {
  readonly kind: EntryKind;
  readonly data: EntriesData;
  readonly onClose: () => void;
  readonly onCreate: (id: string, name: string) => void;
}) {
  const singular = SINGULAR[props.kind];
  const [name, setName] = useState('');
  const [customId, setCustomId] = useState<string | null>(null);
  const taken = props.data.entries.map((e) => e.id);
  const id = customId ?? uniqueId(slugify(name || singular), taken);
  const problem = name.trim() === '' ? 'Give it a name' : idProblem(id, props.data);
  return (
    <Dialog title={`New ${singular}`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!problem) props.onCreate(id, name.trim());
        }}
      >
        <Field label="Name">
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Id">
          <input value={id} spellCheck={false} onChange={(e) => setCustomId(e.target.value)} />
        </Field>
        <p className="hint">
          Events and other entries refer to it by id, so it can’t be changed later. Every other
          field can.
        </p>
        {problem && name !== '' && <p className="error">{problem}</p>}
        <div className="actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={problem !== null}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** A picture of the entry when it has one (enemies). */
function EntryImage({ doc, entry }: { readonly doc: ProjectDocument; readonly entry: Entry }) {
  const image = (entry as { image?: unknown }).image;
  const path = typeof image === 'string' ? image : null;
  const url = useLoaded(path, () => (path ? doc.fs.assetUrl(path) : Promise.resolve(null)));
  if (!path || url.status !== 'ready' || !url.value) return null;
  return <img className="db-image" src={url.value} alt="" />;
}

function Problems({ messages }: { readonly messages: readonly string[] }) {
  if (messages.length === 0) return null;
  return (
    <ul className="db-problems">
      {messages.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}
