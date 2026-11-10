import type { ProjectFs } from '@freequest/editor-core';
import { useEffect, useState } from 'react';
import { IN_DESKTOP_APP, desktopFs, devFs } from './platform.js';

interface Props {
  readonly error: string | null;
  readonly onOpen: (fs: Promise<ProjectFs | null>) => void;
}

export function StartScreen({ error, onOpen }: Props) {
  return (
    <main className="start">
      <div className="start-card">
        <h1>
          FreeQuest <span className="muted">Editor</span>
        </h1>
        <p className="muted">Open a project folder (the one containing project.json).</p>
        {IN_DESKTOP_APP ? (
          <button className="primary" onClick={() => onOpen(desktopFs())}>
            Open project folder…
          </button>
        ) : (
          <DevProjects onOpen={onOpen} />
        )}
        {error && <pre className="error">{error}</pre>}
      </div>
    </main>
  );
}

/** In a browser tab, the dev server offers the sample projects instead of a folder picker. */
function DevProjects({ onOpen }: Pick<Props, 'onOpen'>) {
  const [projects, setProjects] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    import('./fs/dev-fs.js')
      .then(({ listDevProjects }) => listDevProjects())
      .then(setProjects, (e: unknown) => setFailed(String(e)));
  }, []);
  if (failed) return <pre className="error">Could not list sample projects: {failed}</pre>;
  if (!projects) return <p className="muted">Looking for sample projects…</p>;
  return (
    <div className="stack">
      <p className="hint">Browser mode: sample projects from samples/</p>
      {projects.map((name) => (
        <button key={name} className="primary" onClick={() => onOpen(devFs(name))}>
          {name}
        </button>
      ))}
    </div>
  );
}
