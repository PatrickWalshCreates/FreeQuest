import {
  type ProjectDocument,
  type ProjectFile,
  SaveBlockedError,
  allFiles,
  deleteMap,
  duplicateMap,
  mapPath,
  mapUsages,
} from '@freequest/editor-core';
import { DATABASE_KINDS, type GameMap } from '@freequest/schema';
import { useEffect, useState } from 'react';
import { MapEditor } from './map/MapEditor.js';
import { NewMapDialog } from './map/NewMapDialog.js';
import { confirmAction, guardWindowClose } from './platform.js';
import { summarize } from './summary.js';
import { useDocumentVersion } from './use-document.js';

interface Props {
  readonly doc: ProjectDocument;
  readonly onClose: () => void;
  readonly onReload: () => void;
}

interface Group {
  readonly title: string;
  readonly files: readonly ProjectFile[];
  readonly add?: { readonly label: string; readonly onClick: () => void };
}

interface Status {
  readonly kind: 'info' | 'error';
  readonly text: string;
  /** Shown only while the document is still at this version (the next edit clears it). */
  readonly version: number;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isDatabase = (file: ProjectFile) => DATABASE_KINDS.some((k) => k === file.kind);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Sidebar label: the file's own name when it has one, else its id. */
function labelOf(file: ProjectFile): string {
  if (file.kind === 'manifest') return 'Project settings';
  if (isDatabase(file)) return capitalize(file.kind);
  const name = (file.data as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : file.id;
}

export function ProjectView({ doc, onClose, onReload }: Props) {
  const version = useDocumentVersion(doc);
  const project = doc.project;
  const files = allFiles(project);
  const [selected, setSelected] = useState(project.manifest.path);
  const [status, setStatusState] = useState<Status | null>(null);
  const [creating, setCreating] = useState(false);
  const setStatus = (next: Omit<Status, 'version'> | null) =>
    setStatusState(next && { ...next, version: doc.version });

  const save = async () => {
    try {
      const { written, removed } = await doc.save();
      const parts = [
        ...(written.length > 0 ? [`saved ${plural(written.length, 'file')}`] : []),
        ...(removed.length > 0 ? [`deleted ${plural(removed.length, 'file')}`] : []),
      ];
      const text = parts.join(', ');
      setStatus({
        kind: 'info',
        text: text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Nothing to save',
      });
    } catch (error) {
      setStatus({
        kind: 'error',
        text:
          error instanceof SaveBlockedError
            ? `Not saved: ${error.problems.map((p) => `${p.source}: ${p.message}`).join('; ')}`
            : `Save failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  const removeMap = async (id: string) => {
    const name = project.maps.get(id)?.data?.name ?? id;
    const usages = mapUsages(project, id);
    const warning =
      usages.length > 0
        ? `\n\nThese events transfer the player there and will need a new destination:\n${usages.map((u) => `• ${u}`).join('\n')}`
        : '';
    const ok = await confirmAction(
      `Delete the map "${name}"? Its file is deleted when you save (you can undo until then).${warning}`,
      { title: 'Delete map', okLabel: 'Delete map' },
    );
    if (!ok) return;
    try {
      deleteMap(doc, id);
      setStatus({ kind: 'info', text: `Deleted ${name}` });
    } catch (error) {
      setStatus({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    }
  };
  const undo = () => {
    const label = doc.undo();
    setStatus(label ? { kind: 'info', text: `Undid ${label.toLowerCase()}` } : null);
  };
  const redo = () => {
    const label = doc.redo();
    setStatus(label ? { kind: 'info', text: `Redid ${label.toLowerCase()}` } : null);
  };

  // Keyboard shortcuts work everywhere, text fields included, so undo always
  // means the document's history (fields show document data).
  const handlers = { save, undo, redo };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const action =
        key === 's'
          ? handlers.save
          : key === 'z'
            ? event.shiftKey
              ? handlers.redo
              : handlers.undo
            : key === 'y'
              ? handlers.redo
              : null;
      if (!action) return;
      event.preventDefault();
      void action();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });
  useEffect(() => guardWindowClose(() => doc.dirty), [doc]);

  const groups: Group[] = [
    { title: 'Project', files: [project.manifest] },
    {
      title: 'Maps',
      files: [...project.maps.values()],
      add: { label: 'New map', onClick: () => setCreating(true) },
    },
    { title: 'Tilesets', files: [...project.tilesets.values()] },
    { title: 'Characters', files: [...project.characters.values()] },
    { title: 'Database', files: files.filter(isDatabase) },
  ];
  const problemCount = new Map<string, number>();
  for (const p of project.problems) {
    problemCount.set(p.source, (problemCount.get(p.source) ?? 0) + 1);
  }
  const current = files.find((f) => f.path === selected) ?? project.manifest;
  const unsaved = doc.dirtyPaths.length;
  const shortcut = navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl+';

  return (
    <div className="workspace">
      <header className="toolbar">
        <strong>{project.manifest.data.name}</strong>
        <span className="muted path">{project.fs.label}</span>
        <span className="spacer" />
        {status?.version === version && (
          <span className={status.kind === 'error' ? 'status error-text' : 'status muted'}>
            {status.text}
          </span>
        )}
        <button
          onClick={undo}
          disabled={!doc.canUndo}
          title={doc.undoLabel ? `Undo ${doc.undoLabel} (${shortcut}Z)` : 'Nothing to undo'}
        >
          Undo
        </button>
        <button
          onClick={redo}
          disabled={!doc.canRedo}
          title={doc.redoLabel ? `Redo ${doc.redoLabel} (${shortcut}⇧Z)` : 'Nothing to redo'}
        >
          Redo
        </button>
        <button
          className={unsaved > 0 ? 'save unsaved' : 'save'}
          onClick={() => void save()}
          disabled={unsaved === 0}
          title={`Save (${shortcut}S)`}
        >
          {unsaved > 0 ? `Save (${unsaved})` : 'Saved'}
        </button>
        <button onClick={onReload}>Reload</button>
        <button onClick={onClose}>Close</button>
      </header>

      <nav className="sidebar" aria-label="Project files">
        {groups.map((group) => (
          <section key={group.title}>
            <h2>
              {group.title}
              {group.add && (
                <button
                  className="add"
                  title={group.add.label}
                  aria-label={group.add.label}
                  onClick={group.add.onClick}
                >
                  +
                </button>
              )}
            </h2>
            {group.files.length === 0 && <p className="muted empty">(none)</p>}
            <ul>
              {group.files.map((file) => {
                const problems = problemCount.get(file.path) ?? 0;
                const dirty = doc.isDirty(file.path);
                return (
                  <li key={file.path}>
                    <button
                      className={file.path === current.path ? 'item selected' : 'item'}
                      aria-current={file.path === current.path}
                      onClick={() => setSelected(file.path)}
                    >
                      <span>
                        {labelOf(file)}
                        {dirty && (
                          <span className="dirty" title="Unsaved changes" aria-label="unsaved">
                            {' '}
                            ●
                          </span>
                        )}
                      </span>
                      {(problems > 0 || !file.data) && (
                        <span className="badge" title={plural(problems, 'problem')}>
                          {problems || '!'}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </nav>

      {current.kind === 'map' && current.data ? (
        <main className="details map-details">
          <div className="map-header">
            <NameField doc={doc} file={current} />
            <span className="spacer" />
            <button
              onClick={() => {
                const id = duplicateMap(doc, current.id);
                setSelected(mapPath(id));
              }}
            >
              Duplicate
            </button>
            <button className="danger" onClick={() => void removeMap(current.id)}>
              Delete…
            </button>
          </div>
          <MapEditor
            key={current.path}
            doc={doc}
            file={current as ProjectFile<'map'> & { data: GameMap }}
          />
        </main>
      ) : (
        <main className="details">
          <h1>{labelOf(current)}</h1>
          {current.data && 'name' in current.data && <NameField doc={doc} file={current} />}
          <Summary file={current} />
          {!current.data && <p className="error">This file could not be loaded.</p>}
        </main>
      )}

      {creating && (
        <NewMapDialog
          doc={doc}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelected(mapPath(id));
          }}
        />
      )}

      <footer className="problems">
        <h2>
          {project.problems.length === 0
            ? 'No problems'
            : plural(project.problems.length, 'problem')}
        </h2>
        <ul>
          {project.problems.map((p, i) => {
            const file = files.find((f) => f.path === p.source);
            return (
              <li key={i}>
                {file ? (
                  <button className="link" onClick={() => setSelected(file.path)}>
                    {p.source}
                  </button>
                ) : (
                  <span className="source">{p.source}</span>
                )}
                <span>{p.message}</span>
              </li>
            );
          })}
        </ul>
      </footer>
    </div>
  );
}

function Summary({ file }: { readonly file: ProjectFile }) {
  return (
    <dl className="summary">
      {summarize(file).map(([label, value], i) => (
        <div key={i}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The file's `name`, edited in place; typing in it is one undo step until it loses focus. */
function NameField({ doc, file }: { readonly doc: ProjectDocument; readonly file: ProjectFile }) {
  const name = (file.data as { name: string }).name;
  return (
    <label className="field">
      <span>{file.kind === 'manifest' ? 'Game name' : 'Name'}</span>
      <input
        value={name}
        spellCheck={false}
        onChange={(event) => {
          const value = event.target.value;
          // Every file kind with a name stores it the same way.
          doc.update(
            file.path,
            file.kind as 'map',
            'Rename',
            (data) => ({ ...data, name: value }),
            {
              coalesce: `name:${file.path}`,
            },
          );
        }}
        onBlur={() => doc.endCoalescing()}
      />
    </label>
  );
}
