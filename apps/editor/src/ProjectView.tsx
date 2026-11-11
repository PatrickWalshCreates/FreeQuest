import {
  type ProjectDocument,
  type ProjectFile,
  SaveBlockedError,
  allFiles,
  MANIFEST_PATH,
  deleteMap,
  deleteTileset,
  characterUsages,
  deleteCharacter,
  tilesetUsages,
  duplicateMap,
  mapPath,
  mapUsages,
  type PlaytestSource,
  playtestSource,
} from '@freequest/editor-core';
import {
  DATABASE_KINDS,
  type DatabaseKind,
  type GameMap,
  ID_PATTERN,
  type CharacterSheet,
  type Tileset,
} from '@freequest/schema';
import { useEffect, useState } from 'react';
import { AssetsPanel } from './assets/AssetsPanel.js';
import { useAssetPaths } from './assets/use-assets.js';
import { CharacterEditor } from './character/CharacterEditor.js';
import { NewCharacterDialog } from './character/NewCharacterDialog.js';
import { DatabaseEditor } from './database/DatabaseEditor.js';
import { ExportDialog } from './ExportDialog.js';
import { MapEditor } from './map/MapEditor.js';
import { NewMapDialog } from './map/NewMapDialog.js';
import { Playtest, type PlaytestStart } from './Playtest.js';
import { confirmAction, guardWindowClose } from './platform.js';
import { summarize } from './summary.js';
import { NewTilesetDialog } from './tileset/NewTilesetDialog.js';
import { TilesetEditor } from './tileset/TilesetEditor.js';
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

/** The sidebar selection for the Assets panel (not a file path). */
const ASSETS_VIEW = '#assets';

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
  const [creatingTileset, setCreatingTileset] = useState(false);
  const [creatingCharacter, setCreatingCharacter] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [playtest, setPlaytest] = useState<{
    readonly source: PlaytestSource;
    readonly start: PlaytestStart | null;
  } | null>(null);
  const play = (start: PlaytestStart | null = null) => {
    doc.endCoalescing();
    setPlaytest({ source: playtestSource(doc), start });
  };
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
  const removeCharacter = async (id: string) => {
    const name = project.characters.get(id)?.data?.name ?? id;
    const uses = characterUsages(project, id);
    if (uses.length > 0) {
      setStatus({ kind: 'error', text: `${name} can't be deleted: used by ${uses.join(', ')}` });
      return;
    }
    const ok = await confirmAction(
      `Delete the character "${name}"? Its file is deleted when you save (you can undo until then). The image stays in the project's assets.`,
      { title: 'Delete character', okLabel: 'Delete character' },
    );
    if (!ok) return;
    deleteCharacter(doc, id);
    setStatus({ kind: 'info', text: `Deleted ${name}` });
  };
  const removeTileset = async (id: string) => {
    const name = project.tilesets.get(id)?.data?.name ?? id;
    const users = tilesetUsages(project, id);
    if (users.length > 0) {
      setStatus({
        kind: 'error',
        text: `${name} can't be deleted: used by ${users.join(', ')}`,
      });
      return;
    }
    const ok = await confirmAction(
      `Delete the tileset "${name}"? Its file is deleted when you save (you can undo until then). The image stays in the project's assets.`,
      { title: 'Delete tileset', okLabel: 'Delete tileset' },
    );
    if (!ok) return;
    deleteTileset(doc, id);
    setStatus({ kind: 'info', text: `Deleted ${name}` });
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
      // While playtesting, keys belong to the game.
      if (playtest) return;
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
    {
      title: 'Tilesets',
      files: [...project.tilesets.values()],
      add: { label: 'New tileset', onClick: () => setCreatingTileset(true) },
    },
    {
      title: 'Characters',
      files: [...project.characters.values()],
      add: { label: 'New character', onClick: () => setCreatingCharacter(true) },
    },
    { title: 'Database', files: files.filter(isDatabase) },
  ];
  const problemCount = new Map<string, number>();
  for (const p of project.problems) {
    problemCount.set(p.source, (problemCount.get(p.source) ?? 0) + 1);
  }
  const current = files.find((f) => f.path === selected) ?? project.manifest;
  const showAssets = selected === ASSETS_VIEW;
  const assetCount = useAssetPaths(doc)?.length;
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
        <button
          className="play"
          onClick={() => play()}
          title="Play the game from the title screen, with your unsaved changes"
        >
          ▶ Play
        </button>
        <button onClick={() => setExporting(true)} title="Export the game for the web">
          Export…
        </button>
        <button onClick={onReload}>Reload</button>
        <button onClick={onClose}>Close</button>
      </header>

      <nav className="sidebar" aria-label="Project files">
        {groups.map((group, groupIndex) => (
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
                      className={
                        !showAssets && file.path === current.path ? 'item selected' : 'item'
                      }
                      aria-current={!showAssets && file.path === current.path}
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
              {groupIndex === 0 && (
                <li>
                  <button
                    className={showAssets ? 'item selected' : 'item'}
                    aria-current={showAssets}
                    onClick={() => setSelected(ASSETS_VIEW)}
                  >
                    <span>Assets</span>
                    {assetCount !== undefined && <span className="muted">{assetCount}</span>}
                  </button>
                </li>
              )}
            </ul>
          </section>
        ))}
      </nav>

      {showAssets ? (
        <main className="details assets-details">
          <AssetsPanel doc={doc} />
        </main>
      ) : current.kind === 'map' && current.data ? (
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
            onPlayFrom={(x, y) => play({ map: current.id, x, y, label: labelOf(current) })}
          />
        </main>
      ) : current.kind === 'tileset' && current.data ? (
        <main className="details map-details">
          <div className="map-header">
            <NameField doc={doc} file={current} />
            <span className="spacer" />
            <button className="danger" onClick={() => void removeTileset(current.id)}>
              Delete…
            </button>
          </div>
          <TilesetEditor
            key={current.path}
            doc={doc}
            file={current as ProjectFile<'tileset'> & { data: Tileset }}
          />
        </main>
      ) : current.kind === 'character' && current.data ? (
        <main className="details map-details">
          <div className="map-header">
            <NameField doc={doc} file={current} />
            <span className="spacer" />
            <button className="danger" onClick={() => void removeCharacter(current.id)}>
              Delete…
            </button>
          </div>
          <CharacterEditor
            key={current.path}
            doc={doc}
            file={current as ProjectFile<'character'> & { data: CharacterSheet }}
          />
        </main>
      ) : isDatabase(current) && current.data ? (
        <main className="details db-details">
          <DatabaseEditor
            key={current.path}
            doc={doc}
            file={current as ProjectFile<DatabaseKind>}
          />
        </main>
      ) : (
        <main className="details">
          <h1>{labelOf(current)}</h1>
          {current.data && 'name' in current.data && <NameField doc={doc} file={current} />}
          {current.kind === 'manifest' && <GameIdField doc={doc} />}
          <Summary file={current} />
          {!current.data && <p className="error">This file could not be loaded.</p>}
        </main>
      )}

      {playtest && (
        <Playtest
          gameName={project.manifest.data.name}
          source={playtest.source}
          start={playtest.start}
          onClose={() => setPlaytest(null)}
        />
      )}

      {exporting && <ExportDialog doc={doc} onClose={() => setExporting(false)} />}

      {creatingCharacter && (
        <NewCharacterDialog
          doc={doc}
          onClose={() => setCreatingCharacter(false)}
          onImport={() => {
            setCreatingCharacter(false);
            setSelected(ASSETS_VIEW);
          }}
          onCreated={(id) => {
            setCreatingCharacter(false);
            const created = doc.project.characters.get(id);
            if (created) setSelected(created.path);
          }}
        />
      )}

      {creatingTileset && (
        <NewTilesetDialog
          doc={doc}
          onClose={() => setCreatingTileset(false)}
          onImport={() => {
            setCreatingTileset(false);
            setSelected(ASSETS_VIEW);
          }}
          onCreated={(id) => {
            setCreatingTileset(false);
            const created = doc.project.tilesets.get(id);
            if (created) setSelected(created.path);
          }}
        />
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

/** The game's permanent id (keeps its saves apart from other games'). */
function GameIdField({ doc }: { readonly doc: ProjectDocument }) {
  const id = doc.project.manifest.data.id;
  const valid = new RegExp(ID_PATTERN).test(id);
  return (
    <label className="field">
      <span>Game id</span>
      <input
        value={id}
        spellCheck={false}
        onChange={(event) => {
          const value = event.target.value;
          doc.update(MANIFEST_PATH, 'manifest', 'Change game id', (m) => ({ ...m, id: value }), {
            coalesce: 'game-id',
          });
        }}
        onBlur={() => doc.endCoalescing()}
      />
      <span className={valid ? 'hint' : 'field-problem'}>
        {valid
          ? 'Keeps this game’s saves apart from other games. Don’t change it once players have saves.'
          : 'Use lowercase letters, digits, "-" and "_", starting with a letter or digit.'}
      </span>
    </label>
  );
}
