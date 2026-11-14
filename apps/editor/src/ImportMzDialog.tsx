// Import an RPG Maker MZ project: pick its folder, name the new game, choose
// where it goes, then show what came across (the import report) and open it.
// The MZ folder is only read.
import {
  type ProjectFs,
  newProjectProblem,
  parseMarkdown,
  suggestGameId,
} from '@freequest/editor-core';
import {
  IMPORT_REPORT_FILE,
  ImportReport,
  type ImportResult,
  MzProjectError,
  importMzProject,
  readMzProject,
} from '@freequest/importer';
import { useEffect, useMemo, useState } from 'react';
import { Dialog, Field } from './Dialog.js';
import { renderBlock } from './HelpDialog.js';
import {
  IN_DESKTOP_APP,
  bundledTemplates,
  devMzProjects,
  newProjectFs,
  openExternal,
  pickMzFolder,
  pickNewProjectParent,
  projectFolderName,
  templateSource,
} from './platform.js';
import { pngCodec } from './png-codec.js';

interface Props {
  readonly onClose: () => void;
  readonly onImported: (fs: ProjectFs) => void;
}

interface Source {
  readonly fs: ProjectFs;
  readonly label: string;
}

export function ImportMzDialog({ onClose, onImported }: Props) {
  const [source, setSource] = useState<Source | null>(null);
  const [devSources, setDevSources] = useState<Source[] | null>(null);
  const [name, setName] = useState('');
  const [customId, setCustomId] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    result: ImportResult;
    fs: ProjectFs;
    location: string;
  } | null>(null);

  useEffect(() => {
    if (!IN_DESKTOP_APP) devMzProjects().then(setDevSources, (e: unknown) => setError(String(e)));
  }, []);

  // Read the chosen project's title to suggest the name.
  const choose = async (picked: Source) => {
    setError(null);
    try {
      const mz = await readMzProject(picked.fs, new ImportReport());
      setSource(picked);
      setName(mz.system.title || 'Imported game');
      setCustomId(null);
    } catch (e) {
      setSource(null);
      setError(e instanceof MzProjectError || e instanceof Error ? e.message : String(e));
    }
  };

  const id = customId ?? suggestGameId(name);
  const folder = projectFolderName(name);
  const location = IN_DESKTOP_APP
    ? parent
      ? `${parent.replace(/[\\/]+$/, '')}/${folder}`
      : null
    : `projects/${folder}`;
  const problem = source ? newProjectProblem({ name, id }) : null;

  const start = async () => {
    if (!source || problem || !location) return;
    setError(null);
    try {
      const target = await newProjectFs(parent, folder);
      if ((await target.list('')).length > 0) {
        throw new Error(
          `${location} already exists and isn't empty. Choose another name or place.`,
        );
      }
      const templates = await bundledTemplates();
      const starter = templates.find((t) => t.id === 'starter');
      if (!starter) throw new Error('The Starter template is missing from this editor.');
      setProgress({ done: 0, total: 1 });
      const result = await importMzProject(source.fs, target, {
        template: templateSource(starter),
        images: pngCodec,
        name,
        id,
        onProgress: (d, total) => setProgress({ done: d, total }),
      });
      setDone({ result, fs: target, location });
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (done) return <ImportDone {...done} onClose={onClose} onOpen={() => onImported(done.fs)} />;

  return (
    <Dialog title="Import an RPG Maker MZ project" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <p className="hint">
          FreeQuest makes a new project from your MZ project’s maps, database, events, pictures and
          sounds. Your MZ project isn’t changed. Anything FreeQuest can’t bring across is listed in
          a report, and left as a comment where it was.
        </p>
        <div className="field">
          <span>MZ project</span>
          {IN_DESKTOP_APP ? (
            <div className="inline">
              <code className="grow">{source?.label ?? 'The folder with game.rmmzproject'}</code>
              <button
                type="button"
                onClick={() =>
                  void pickMzFolder().then((picked) => {
                    if (picked) void choose(picked);
                  })
                }
              >
                Choose…
              </button>
            </div>
          ) : (
            <div className="export-targets" role="radiogroup" aria-label="MZ project">
              {(devSources ?? []).map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={source?.label === s.label}
                  className={source?.label === s.label ? 'export-target on' : 'export-target'}
                  onClick={() => void choose(s)}
                >
                  <strong>{s.label}</strong>
                </button>
              ))}
              {devSources?.length === 0 && (
                <span className="hint">
                  Browser mode: put MZ project folders in mz-projects/ (or set FREEQUEST_MZ_DIR).
                </span>
              )}
            </div>
          )}
        </div>

        {source && (
          <>
            <Field label="Game name">
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Game id">
              <input value={id} spellCheck={false} onChange={(e) => setCustomId(e.target.value)} />
            </Field>
            <div className="field">
              <span>New project folder</span>
              <div className="inline">
                <code className="grow">{location ?? 'Choose where to put it'}</code>
                {IN_DESKTOP_APP && (
                  <button
                    type="button"
                    onClick={() =>
                      void pickNewProjectParent().then((p) => {
                        if (p) setParent(p);
                      })
                    }
                  >
                    Choose…
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {progress && (
          <div
            className="progress"
            role="progressbar"
            aria-valuenow={progress.done}
            aria-valuemax={progress.total}
          >
            <div style={{ width: `${(100 * progress.done) / Math.max(1, progress.total)}%` }} />
          </div>
        )}
        {(error ?? problem) && <p className="error">{error ?? problem}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!source || problem !== null || !location || progress !== null}
          >
            {progress ? 'Importing…' : 'Import'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

/** After an import: what came across, the report, and a way in. */
function ImportDone({
  result,
  location,
  onClose,
  onOpen,
}: {
  readonly result: ImportResult;
  readonly location: string;
  readonly onClose: () => void;
  readonly onOpen: () => void;
}) {
  const { report } = result;
  const blocks = useMemo(
    () => parseMarkdown(report.toMarkdown(`Importing “${result.name}”`)).slice(1),
    [report, result.name],
  );
  const missing = report.count('missing');
  const changed = report.count('changed');
  const follow = (href: string) => void openExternal(href);
  return (
    <Dialog title="Imported" onClose={onClose}>
      <div className="form">
        <p>
          <strong>{result.name}</strong> is now a FreeQuest project in <code>{location}</code>.
        </p>
        <p className="hint">
          {missing + changed === 0
            ? 'Everything came across.'
            : `${missing} ${missing === 1 ? 'thing' : 'things'} couldn’t come across and ${changed} work a little differently. The list below is also saved in the project as ${IMPORT_REPORT_FILE}.`}
        </p>
        {blocks.length > 0 && (
          <div className="import-report help-body">
            {blocks.map((b, i) => renderBlock(b, i, follow))}
          </div>
        )}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Close
          </button>
          <button type="button" className="primary" autoFocus onClick={onOpen}>
            Open the project
          </button>
        </div>
      </div>
    </Dialog>
  );
}
