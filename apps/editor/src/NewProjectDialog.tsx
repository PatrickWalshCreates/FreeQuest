import {
  type ProjectFs,
  createProject,
  newProjectProblem,
  suggestGameId,
} from '@freequest/editor-core';
import { useEffect, useState } from 'react';
import { Dialog, Field } from './Dialog.js';
import {
  type BundledTemplate,
  IN_DESKTOP_APP,
  bundledTemplates,
  newProjectFs,
  pickNewProjectParent,
  projectFolderName,
  templateSource,
} from './platform.js';

interface Props {
  readonly onClose: () => void;
  readonly onCreated: (fs: ProjectFs) => void;
}

/** Name the game, pick a template and a place, and create the project folder. */
export function NewProjectDialog({ onClose, onCreated }: Props) {
  const [templates, setTemplates] = useState<BundledTemplate[] | null>(null);
  const [templateId, setTemplateId] = useState('starter');
  const [name, setName] = useState('My Game');
  const [customId, setCustomId] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bundledTemplates().then(setTemplates, (e: unknown) => setError(String(e)));
  }, []);

  const id = customId ?? suggestGameId(name);
  const folder = projectFolderName(name);
  const location = IN_DESKTOP_APP
    ? parent
      ? `${parent.replace(/[\\/]+$/, '')}/${folder}`
      : null
    : `projects/${folder}`;
  const problem = newProjectProblem({ name, id });
  const template = templates?.find((t) => t.id === templateId);

  const create = async () => {
    if (!template || problem) return;
    setError(null);
    try {
      const fs = await newProjectFs(parent, folder);
      if ((await fs.list('')).length > 0) {
        throw new Error(
          `${location ?? folder} already exists and isn't empty. Choose another name or place.`,
        );
      }
      setProgress({ done: 0, total: template.files.length });
      await createProject(templateSource(template), fs, {
        name,
        id,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      onCreated(fs);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Dialog title="New project" onClose={onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <Field label="Game name">
          <input value={name} autoFocus onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Game id">
          <input value={id} spellCheck={false} onChange={(e) => setCustomId(e.target.value)} />
        </Field>
        <p className="hint">
          The id keeps this game’s saves apart from other games. Keep it once players have saves.
        </p>

        <div className="field">
          <span>Start from</span>
          <div className="export-targets" role="radiogroup" aria-label="Template">
            {(templates ?? []).map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={t.id === templateId}
                className={t.id === templateId ? 'export-target on' : 'export-target'}
                onClick={() => setTemplateId(t.id)}
              >
                <strong>{t.name}</strong>
                <span className="hint">{t.description}</span>
              </button>
            ))}
          </div>
          {!templates && !error && <span className="hint">Loading templates…</span>}
        </div>

        <div className="field">
          <span>Folder</span>
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
        {(error ?? (name !== '' ? problem : null)) && <p className="error">{error ?? problem}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="primary"
            disabled={!template || problem !== null || !location || progress !== null}
          >
            {progress ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
