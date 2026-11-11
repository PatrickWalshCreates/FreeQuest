import type { ProjectFs, RecentProject } from '@freequest/editor-core';
import { FREEQUEST_VERSION } from '@freequest/schema';
import { useEffect, useState } from 'react';
import { type HelpPage, HelpDialog } from './HelpDialog.js';
import { NewProjectDialog } from './NewProjectDialog.js';
import { IN_DESKTOP_APP, desktopFs, devFs, projectFsAt } from './platform.js';
import { forgetProject, loadRecent } from './recent.js';

interface Props {
  readonly error: string | null;
  /** A recent project that just failed to open. */
  readonly failed: string | null;
  /** `recent` is the location when the project was picked from the recent list. */
  readonly onOpen: (fs: Promise<ProjectFs | null>, recent?: string) => void;
}

export function StartScreen({ error, failed, onOpen }: Props) {
  const [creating, setCreating] = useState(false);
  const [help, setHelp] = useState<HelpPage | null>(null);
  const [recent, setRecent] = useState(loadRecent);
  const forget = (location: string) => {
    forgetProject(location);
    setRecent(loadRecent());
  };
  return (
    <main className="start">
      <div className="start-card">
        <h1>
          FreeQuest <span className="muted">Editor</span>
          <span className="version">{FREEQUEST_VERSION}</span>
        </h1>
        {recent.length === 0 ? (
          <div className="welcome">
            <p>
              Welcome! Make a game from the <strong>Starter</strong> template, or pick{' '}
              <strong>Demo</strong> to see what FreeQuest can do. The guide walks you through a
              first game in about half an hour.
            </p>
            <button className="link" onClick={() => setHelp('getting-started')}>
              Open the Getting started guide
            </button>
          </div>
        ) : (
          <p className="muted">
            Start a new game, or open a project folder (the one with project.json).
          </p>
        )}
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
        {failed && recent.some((p) => p.location === failed) && (
          <button onClick={() => forget(failed)}>Remove it from Recent</button>
        )}
        {recent.length > 0 && (
          <RecentList
            projects={recent}
            onOpen={(location) => onOpen(projectFsAt(location), location)}
            onForget={forget}
          />
        )}
      </div>
      <div className="start-links">
        <button className="link" onClick={() => setHelp('getting-started')}>
          Guide
        </button>
        <button className="link" onClick={() => setHelp('about')}>
          About FreeQuest
        </button>
      </div>
      {help && <HelpDialog page={help} onClose={() => setHelp(null)} />}
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

function RecentList({
  projects,
  onOpen,
  onForget,
}: {
  readonly projects: readonly RecentProject[];
  readonly onOpen: (location: string) => void;
  readonly onForget: (location: string) => void;
}) {
  return (
    <section className="recent">
      <h2>Recent</h2>
      <ul>
        {projects.map((p) => (
          <li key={p.location}>
            <button className="recent-open" title={p.location} onClick={() => onOpen(p.location)}>
              <span className="recent-name">{p.name}</span>
              <span className="recent-where">{p.location}</span>
            </button>
            <button
              className="recent-forget"
              title="Remove from Recent (the project's files stay)"
              aria-label={`Remove ${p.name} from Recent`}
              onClick={() => onForget(p.location)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </section>
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
