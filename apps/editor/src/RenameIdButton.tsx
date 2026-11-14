// "Rename id…": change a switch's, map's, event's or entry's id and every
// reference to it, as one undo step (editor-core `renameId`). Saves made
// before keep loading through the manifest's rename record.
import {
  type ProjectDocument,
  type RenameKind,
  referencesTo,
  renameId,
  renameProblem,
} from '@freequest/editor-core';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Dialog, Field } from './Dialog.js';

export function RenameIdButton(props: {
  readonly doc: ProjectDocument;
  readonly kind: RenameKind;
  /** The current id ("<map>/<event>" for events). */
  readonly id: string;
  /** What it is, for the dialog: "switch", "map", "item"… */
  readonly what: string;
  /** Called with the new id after a rename (to keep a selection on it). */
  readonly onRenamed?: (newId: string) => void;
  readonly className?: string;
  /** The button's text (default "Rename id…"), e.g. the id itself. */
  readonly label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={props.className ?? 'small'}
        title={`Change this ${props.what}’s id, and everything that refers to it`}
        onClick={() => setOpen(true)}
      >
        {props.label ?? 'Rename id…'}
      </button>
      {/* The button sits inside paragraphs and forms, where a dialog can't go: render it at the top. */}
      {open &&
        createPortal(<RenameDialog {...props} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

function RenameDialog(props: {
  readonly doc: ProjectDocument;
  readonly kind: RenameKind;
  readonly id: string;
  readonly what: string;
  readonly onRenamed?: (newId: string) => void;
  readonly onClose: () => void;
}) {
  const { doc, kind, id, what } = props;
  const bare = kind === 'event' ? id.slice(id.indexOf('/') + 1) : id;
  const [value, setValue] = useState(bare);
  const project = doc.project;
  const problem = renameProblem(project, kind, id, value);
  const uses = referencesTo(project, kind, id).length;
  return (
    <Dialog title={`Rename ${what} id`} onClose={props.onClose}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          // React passes a portal's events to its parents: keep this submit from reaching a form.
          e.stopPropagation();
          if (problem) return;
          renameId(doc, kind, id, value);
          props.onRenamed?.(value);
          props.onClose();
        }}
      >
        <Field label="New id">
          <input
            value={value}
            autoFocus
            spellCheck={false}
            onChange={(e) => setValue(e.target.value)}
          />
        </Field>
        <p className="hint">
          {uses === 0
            ? 'Nothing refers to it yet.'
            : `${uses === 1 ? '1 place refers' : `${uses} places refer`} to “${bare}”: all of them change too.`}{' '}
          Saves made before keep working. You can undo this.
        </p>
        {problem && value !== bare && <p className="error">{problem}</p>}
        <div className="actions">
          <button type="button" onClick={props.onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={problem !== null}>
            Rename
          </button>
        </div>
      </form>
    </Dialog>
  );
}
