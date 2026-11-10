import {
  type ExportPlan,
  type ProjectDocument,
  clearExport,
  exportWeb,
  inspectTarget,
  planExport,
} from '@freequest/editor-core';
import { useEffect, useState } from 'react';
import { Dialog, Field } from './Dialog.js';
import {
  type ExportFolder,
  IN_DESKTOP_APP,
  bundledPlayer,
  confirmAction,
  devExportFolder,
  pickExportFolder,
} from './platform.js';

/** The editor's version, recorded in each export's marker file. */
const FREEQUEST_VERSION = '0.0.0';

type Phase =
  | { readonly step: 'review' }
  | { readonly step: 'exporting'; readonly done: number; readonly total: number }
  | {
      readonly step: 'done';
      readonly folder: ExportFolder;
      readonly files: number;
      readonly bytes: number;
    }
  | { readonly step: 'failed'; readonly message: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Check the project, choose a folder, and export the game for the web. */
export function ExportDialog({
  doc,
  onClose,
}: {
  readonly doc: ProjectDocument;
  readonly onClose: () => void;
}) {
  const project = doc.project;
  const manifest = project.manifest.data;
  const [plan, setPlan] = useState<ExportPlan | null>(null);
  const [phase, setPhase] = useState<Phase>({ step: 'review' });
  const [folder, setFolder] = useState<ExportFolder | null>(null);
  const [devName, setDevName] = useState(`${manifest.id}-web`);

  useEffect(() => {
    let current = true;
    planExport(project, doc.fs).then(
      (p) => current && setPlan(p),
      (e: unknown) => current && setPhase({ step: 'failed', message: String(e) }),
    );
    return () => {
      current = false;
    };
  }, [doc, project]);

  const run = async () => {
    if (!plan) return;
    try {
      const target = IN_DESKTOP_APP ? folder : await devExportFolder(devName);
      if (!target) return;
      if (IN_DESKTOP_APP && doc.fs.label && target.label.startsWith(doc.fs.label)) {
        throw new Error('Choose a folder outside the project folder.');
      }
      const state = await inspectTarget(target.fs);
      if (state.kind === 'other') {
        throw new Error(
          `${target.label} already has other files in it. Choose an empty folder (or a previous export).`,
        );
      }
      if (state.kind === 'export') {
        const ok = await confirmAction(
          `${target.label} holds a previous export${state.game ? ` of “${state.game}”` : ''}. Replace it?`,
          { title: 'Replace export', okLabel: 'Replace' },
        );
        if (!ok) return;
        await clearExport(target.fs);
      }
      const player = await bundledPlayer();
      setPhase({ step: 'exporting', done: 0, total: plan.files.length + player.files.length });
      const result = await exportWeb({
        project,
        plan,
        source: doc.fs,
        target: target.fs,
        player,
        freequestVersion: FREEQUEST_VERSION,
        onProgress: (p) => setPhase({ step: 'exporting', done: p.done, total: p.total }),
      });
      setPhase({ step: 'done', folder: target, files: result.files, bytes: result.bytes });
    } catch (error) {
      setPhase({ step: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  };

  const blocked = !plan || plan.errors.length > 0;
  const assets = plan?.files.filter((f) => f.kind === 'asset').length ?? 0;
  const data = plan ? plan.files.length - assets : 0;

  return (
    <Dialog title={`Export ${manifest.name}`} onClose={onClose}>
      <div className="form export">
        {phase.step === 'done' ? (
          <>
            <p className="success">
              Exported {plural(phase.files, 'game file')} ({megabytes(phase.bytes)}) to{' '}
              <code>{phase.folder.label}</code>.
            </p>
            <p className="hint">
              Upload the whole folder to a web host (itch.io works: zip it and choose “This file
              will be played in the browser”). index.html starts the game. Opening index.html
              straight from your disk won’t work: browsers need it served.
            </p>
            <div className="actions">
              {phase.folder.playUrl && (
                <a
                  className="button primary"
                  href={phase.folder.playUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Play the export
                </a>
              )}
              <button onClick={onClose}>Close</button>
            </div>
          </>
        ) : (
          <>
            <div className="export-target">
              <strong>Web</strong>
              <span className="hint">
                A folder for any web host. Players open a link and play; saves stay in their
                browser.
              </span>
            </div>

            {!plan ? (
              <p className="hint">Checking the project…</p>
            ) : (
              <>
                <p className="hint">
                  {plural(data, 'data file')} and{' '}
                  {plural(assets, 'image or sound', 'images and sounds')}
                  {doc.dirty ? ' · unsaved changes are included' : ''}. Unused files are left out.
                </p>
                {plan.errors.length > 0 && (
                  <div className="export-problems">
                    <strong>
                      Fix {plural(plan.errors.length, 'problem')} first: the game wouldn’t start.
                    </strong>
                    <ul>
                      {plan.errors.map((p, i) => (
                        <li key={i}>
                          <code>{p.source}</code> {p.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {plan.warnings.length > 0 && (
                  <div className="export-warnings">
                    <strong>
                      {plural(plan.warnings.length, 'warning')} (the game still runs):
                    </strong>
                    <ul>
                      {plan.warnings.map((p, i) => (
                        <li key={i}>
                          <code>{p.source}</code> {p.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {IN_DESKTOP_APP ? (
              <div className="field">
                <span>Export folder</span>
                <div className="inline">
                  <code className="grow">{folder?.label ?? 'No folder chosen'}</code>
                  <button
                    onClick={() =>
                      void pickExportFolder().then((f) => {
                        if (f) setFolder(f);
                      })
                    }
                  >
                    Choose…
                  </button>
                </div>
              </div>
            ) : (
              <Field label="Export folder (under exports/ in the repo)">
                <input
                  value={devName}
                  spellCheck={false}
                  onChange={(e) => setDevName(e.target.value)}
                />
              </Field>
            )}

            {phase.step === 'exporting' && (
              <div
                className="progress"
                role="progressbar"
                aria-valuenow={phase.done}
                aria-valuemax={phase.total}
              >
                <div style={{ width: `${(100 * phase.done) / Math.max(1, phase.total)}%` }} />
              </div>
            )}
            {phase.step === 'failed' && <p className="error">{phase.message}</p>}

            <div className="actions">
              <button onClick={onClose}>Cancel</button>
              <button
                className="primary"
                disabled={
                  blocked ||
                  phase.step === 'exporting' ||
                  (IN_DESKTOP_APP ? !folder : !/^[a-z0-9][a-z0-9_-]*$/.test(devName))
                }
                onClick={() => void run()}
              >
                {phase.step === 'exporting' ? 'Exporting…' : 'Export'}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
