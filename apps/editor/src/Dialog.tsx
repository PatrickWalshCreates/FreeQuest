import { type ReactNode, useEffect, useRef } from 'react';

interface Props {
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}

/** A modal dialog (native <dialog>: focus trapping and Escape come for free). */
export function Dialog({ title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Keys inside a dialog belong to it, not to the editor's shortcuts behind it.
      onKeyDown={(event) => event.stopPropagation()}
    >
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

/** Label + control, stacked. */
export function Field(props: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="field">
      <span>{props.label}</span>
      {props.children}
    </label>
  );
}
