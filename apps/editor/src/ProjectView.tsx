import { type OpenedProject, type ProjectFile, allFiles } from '@freequest/editor-core';
import { DATABASE_KINDS } from '@freequest/schema';
import { useMemo, useState } from 'react';
import { summarize } from './summary.js';

interface Props {
  readonly project: OpenedProject;
  readonly onClose: () => void;
  readonly onReload: () => void;
}

interface Group {
  readonly title: string;
  readonly files: readonly ProjectFile[];
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Sidebar label: the file's own name when it has one, else its id. */
function labelOf(file: ProjectFile): string {
  if (file.kind === 'manifest') return 'Project settings';
  if (DATABASE_KINDS.some((k) => k === file.kind)) return capitalize(file.kind);
  const name = (file.data as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name ? name : file.id;
}

export function ProjectView({ project, onClose, onReload }: Props) {
  const files = useMemo(() => allFiles(project), [project]);
  const [selected, setSelected] = useState(project.manifest.path);
  const groups: Group[] = [
    { title: 'Project', files: [project.manifest] },
    { title: 'Maps', files: [...project.maps.values()] },
    { title: 'Tilesets', files: [...project.tilesets.values()] },
    { title: 'Characters', files: [...project.characters.values()] },
    { title: 'Database', files: files.filter((f) => DATABASE_KINDS.some((k) => k === f.kind)) },
  ];
  const problemCount = new Map<string, number>();
  for (const p of project.problems)
    problemCount.set(p.source, (problemCount.get(p.source) ?? 0) + 1);
  const current = files.find((f) => f.path === selected) ?? project.manifest;

  return (
    <div className="workspace">
      <header className="toolbar">
        <strong>{project.manifest.data.name}</strong>
        <span className="muted path">{project.fs.label}</span>
        <span className="spacer" />
        <button onClick={onReload}>Reload</button>
        <button onClick={onClose}>Close</button>
      </header>

      <nav className="sidebar" aria-label="Project files">
        {groups.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            {group.files.length === 0 && <p className="muted empty">(none)</p>}
            <ul>
              {group.files.map((file) => {
                const problems = problemCount.get(file.path) ?? 0;
                return (
                  <li key={file.path}>
                    <button
                      className={file.path === current.path ? 'item selected' : 'item'}
                      aria-current={file.path === current.path}
                      onClick={() => setSelected(file.path)}
                    >
                      <span>{labelOf(file)}</span>
                      {(problems > 0 || !file.data) && (
                        <span className="badge" title={`${problems} problem(s)`}>
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

      <main className="details">
        <h1>{labelOf(current)}</h1>
        <dl>
          {summarize(current).map(([label, value], i) => (
            <div key={i}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {!current.data && <p className="error">This file could not be loaded.</p>}
      </main>

      <footer className="problems">
        <h2>
          {project.problems.length === 0
            ? 'No problems'
            : `${project.problems.length} problem${project.problems.length === 1 ? '' : 's'}`}
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
