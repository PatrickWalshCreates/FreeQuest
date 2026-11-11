import type { ProjectFs } from '@freequest/editor-core';
import { useEffect, useState } from 'react';
import { NewProjectDialog } from './NewProjectDialog.js';
import { IN_DESKTOP_APP, desktopFs, devFs } from './platform.js';

interface Props {
  readonly error: string | null;
  readonly onOpen: (fs: Promise<ProjectFs | null>) => void;
}

export function StartScreen({ error, onOpen }: Props) {
  const [creating, setCreating] = useState(false);
  return (
    <main className="start">
      <div className="start-card">
        <h1>
          FreeQuest <span className="muted">Editor</span>
        </h1>
        <p className="muted">
          Start a new game, or open a project folder (the one with project.json).
        </p>
        <div className="stack">
          <button className="primary" onClick={() => setCreating(true)}>
            New project…
          </button>
          {IN_DESKTOP_APP ? (
            <button onClick={() => onOpen(desktopFs())}>Open project folder…</button>
          ) : (
            <DevProjects onOpen={onOpen} />
          )}
        </div>
        {error && <pre className="error">{error}</pre>}
      </div>
      {creating && (
        <NewProjectDialog
          onClose={() => setCreating(false)}
          onCreated={(fs) => {
            setCreating(false);
            onOpen(Promise.resolve(fs));
          }}
        />
      )}
    </main>
  );
}

/** In a browser tab, the dev server offers the sample projects and ones made here. */
function DevProjects({ onOpen }: Pick<Props, 'onOpen'>) {
  const [projects, setProjects] = useState<{ area: 'samples' | 'projects'; name: string }[] | null>(
    null,
  );
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    import('./fs/dev-fs.js')
      .then(({ listDevProjects }) => listDevProjects())
      .then(
        (list) =>
          setProjects(
            list.flatMap((p) =>
              p.area === 'samples' || p.area === 'projects' ? [{ area: p.area, name: p.name }] : [],
            ),
          ),
        (e: unknown) => setFailed(String(e)),
      );
  }, []);
  if (failed) return <pre className="error">Could not list projects: {failed}</pre>;
  if (!projects) return <p className="muted">Looking for projects…</p>;
  return (
    <>
      <p className="hint">Browser mode: projects in samples/ and projects/</p>
      {projects.map((p) => (
        <button key={`${p.area}/${p.name}`} onClick={() => onOpen(devFs(p.name, p.area))}>
          {p.area}/{p.name}
        </button>
      ))}
    </>
  );
}
