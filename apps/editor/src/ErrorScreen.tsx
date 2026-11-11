// When the editor's UI crashes, this shows what happened instead of a blank
// window: copy the details for a bug report, save unsaved changes (the
// document lives outside the crashed screen), or try again.
import type { ProjectDocument } from '@freequest/editor-core';
import { FREEQUEST_VERSION } from '@freequest/schema';
import { Component, type ErrorInfo, type ReactNode, useState } from 'react';

interface BoundaryProps {
  readonly children: ReactNode;
  /** The open project, so its unsaved changes can still be saved. */
  readonly doc?: ProjectDocument;
  /** Leave the crashed screen (e.g. back to the start screen). */
  readonly onLeave?: () => void;
  readonly leaveLabel?: string;
}

interface BoundaryState {
  readonly error: Error | null;
  readonly componentStack: string;
}

/** Catches errors while drawing its children and shows the error screen instead. */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, componentStack: '' };

  static getDerivedStateFromError(error: unknown): Partial<BoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('The editor hit an error', error);
    if (import.meta.env.DEV) sessionStorage.removeItem('freequest:test-crash');
    this.setState({ componentStack: info.componentStack ?? '' });
  }

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    if (!error) return this.props.children;
    return (
      <ErrorScreen
        error={error}
        componentStack={componentStack}
        {...(this.props.doc ? { doc: this.props.doc } : {})}
        onRetry={() => this.setState({ error: null, componentStack: '' })}
        {...(this.props.onLeave
          ? { onLeave: this.props.onLeave, leaveLabel: this.props.leaveLabel ?? 'Leave' }
          : {})}
      />
    );
  }
}

/**
 * Development builds only: `sessionStorage.setItem('freequest:test-crash', '1')` makes the
 * next render of the project screen throw, to try the error screen.
 */
export function DevCrash(): null {
  // The flag stays until the boundary has caught it (React retries a failed render once).
  if (import.meta.env.DEV && sessionStorage.getItem('freequest:test-crash') === '1') {
    throw new Error('A test crash (freequest:test-crash)');
  }
  return null;
}

/** Everything a bug report needs, as plain text. */
export function errorDetails(error: Error, componentStack: string): string {
  return [
    `FreeQuest Editor ${FREEQUEST_VERSION}`,
    `Browser: ${navigator.userAgent}`,
    '',
    `${error.name}: ${error.message}`,
    error.stack ?? '',
    componentStack ? `\nIn:${componentStack}` : '',
  ]
    .join('\n')
    .trim();
}

function ErrorScreen(props: {
  readonly error: Error;
  readonly componentStack: string;
  readonly doc?: ProjectDocument;
  readonly onRetry: () => void;
  readonly onLeave?: () => void;
  readonly leaveLabel?: string;
}) {
  const { error, doc } = props;
  const [note, setNote] = useState<string | null>(null);
  const details = errorDetails(error, props.componentStack);
  const unsaved = doc?.dirtyPaths.length ?? 0;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(details);
      setNote('Copied. Paste it into a bug report, please.');
    } catch {
      setNote('Copying was refused: select the text below and copy it instead.');
    }
  };
  const save = async () => {
    if (!doc) return;
    try {
      const { written } = await doc.save();
      setNote(
        `Saved ${written.length} file${written.length === 1 ? '' : 's'}. Your work is safe on disk.`,
      );
    } catch (e) {
      setNote(`Saving failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <main className="error-screen" role="alert">
      <div className="error-card">
        <h1>Something went wrong</h1>
        <p>
          The editor hit a problem it didn't expect: <strong>{error.message || error.name}</strong>
        </p>
        <p className="muted">
          {doc
            ? unsaved > 0
              ? `You have unsaved changes in ${unsaved} file${unsaved === 1 ? '' : 's'}: save them first, then try again.`
              : 'Your project is saved; nothing is lost.'
            : 'Try again, or reload the editor.'}{' '}
          If it keeps happening, please report it with the details below.
        </p>
        <div className="error-actions">
          {doc && unsaved > 0 && (
            <button className="primary" onClick={() => void save()}>
              Save my changes
            </button>
          )}
          <button onClick={props.onRetry}>Try again</button>
          {props.onLeave && <button onClick={props.onLeave}>{props.leaveLabel}</button>}
          <button onClick={() => void copy()}>Copy details</button>
        </div>
        {note && <p className="hint">{note}</p>}
        <details>
          <summary>Details</summary>
          <pre className="notices">{details}</pre>
        </details>
      </div>
    </main>
  );
}
