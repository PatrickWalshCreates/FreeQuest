// Project settings: the game's switches and variables. Add them, change
// their names, see where each is used, and delete unused ones. Ids are made
// from the name once and stay fixed (events refer to them by id).
import {
  type GameStateKind,
  MANIFEST_PATH,
  type ProjectDocument,
  addDeclaration,
  removeDeclaration,
  renameDeclaration,
  usagesOf,
} from '@freequest/editor-core';
import type { Manifest } from '@freequest/schema';
import { useState } from 'react';
import { confirmAction } from './platform.js';

const WORDS: Record<GameStateKind, { one: string; many: string; what: string }> = {
  switches: {
    one: 'switch',
    many: 'Switches',
    what: 'On/off flags the whole game shares, e.g. “Accepted the quest”.',
  },
  variables: {
    one: 'variable',
    many: 'Variables',
    what: 'Whole numbers the whole game shares, e.g. “Coins found”.',
  },
};

export function SwitchesAndVariables({ doc }: { readonly doc: ProjectDocument }) {
  return (
    <section className="game-state">
      <List doc={doc} kind="switches" />
      <List doc={doc} kind="variables" />
    </section>
  );
}

function List({ doc, kind }: { readonly doc: ProjectDocument; readonly kind: GameStateKind }) {
  const project = doc.project;
  const list = project.manifest.data[kind];
  const words = WORDS[kind];
  const refKind = kind === 'switches' ? 'switch' : 'variable';
  const [newName, setNewName] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const edit = (label: string, change: (m: Manifest) => Manifest, coalesce?: string) =>
    doc.update(MANIFEST_PATH, 'manifest', label, change, coalesce ? { coalesce } : {});

  const add = () => {
    if (!newName.trim()) return;
    edit(`Add ${words.one}`, (m) => addDeclaration(m, kind, newName).manifest);
    setNewName('');
  };
  const remove = async (id: string, name: string) => {
    const uses = usagesOf(project, refKind, id);
    const warning =
      uses.length > 0
        ? ` It's used by ${uses.length === 1 ? uses[0] : `${uses.length} places: ${uses.join(', ')}`}, which will show a problem until you change them.`
        : '';
    const ok = await confirmAction(
      `Delete the ${words.one} “${name || id}”?${warning} You can undo this.`,
      {
        title: `Delete ${words.one}`,
        okLabel: 'Delete',
      },
    );
    if (ok) edit(`Delete ${words.one}`, (m) => removeDeclaration(m, kind, id));
  };

  return (
    <div className="game-state-list" onBlur={() => doc.endCoalescing()}>
      <h2>{words.many}</h2>
      <p className="hint">{words.what}</p>
      {list.length === 0 && <p className="muted">No {kind} yet.</p>}
      <ul>
        {list.map((d) => {
          const uses = usagesOf(project, refKind, d.id);
          return (
            <li key={d.id}>
              <div className="row">
                <input
                  className="grow"
                  value={d.name}
                  aria-label={`${words.one} name`}
                  onChange={(e) =>
                    edit(
                      `Rename ${words.one}`,
                      (m) => renameDeclaration(m, kind, d.id, e.target.value),
                      `name:${kind}:${d.id}`,
                    )
                  }
                />
                <code className="muted">{d.id}</code>
                <button
                  className="small"
                  aria-expanded={open === d.id}
                  title={uses.length > 0 ? 'Show where it’s used' : 'Nothing uses it yet'}
                  disabled={uses.length === 0}
                  onClick={() => setOpen(open === d.id ? null : d.id)}
                >
                  {uses.length === 0 ? 'Unused' : `Used by ${uses.length}`}
                </button>
                <button className="small danger" onClick={() => void remove(d.id, d.name)}>
                  Delete…
                </button>
              </div>
              {open === d.id && (
                <ul className="used-by">
                  {uses.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input
          className="grow"
          placeholder={`New ${words.one} name`}
          aria-label={`New ${words.one} name`}
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
        />
        <button type="submit" className="small" disabled={!newName.trim()}>
          + Add {words.one}
        </button>
      </form>
    </div>
  );
}
