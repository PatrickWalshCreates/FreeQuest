import { ProjectDocument, type ProjectFs, openProject } from '@freequest/editor-core';
import { useState } from 'react';
import { ErrorBoundary } from './ErrorScreen.js';
import { ProjectView } from './ProjectView.js';
import { StartScreen } from './StartScreen.js';
import { confirmDiscard, projectLocation } from './platform.js';
import { rememberProject } from './recent.js';

type AppState =
  | {
      readonly screen: 'start';
      readonly error: string | null;
      /** The recent project that just failed to open, so the list can offer to remove it. */
      readonly failed?: string;
    }
  | { readonly screen: 'opening'; readonly label: string }
  | { readonly screen: 'project'; readonly doc: ProjectDocument };

export function App() {
  const [state, setState] = useState<AppState>({ screen: 'start', error: null });

  /** Open the project `pick` resolves to; `recent` is its location when picked from the list. */
  const open = async (pick: Promise<ProjectFs | null>, recent?: string) => {
    try {
      const fs = await pick;
      if (!fs) return;
      setState({ screen: 'opening', label: fs.label });
      const doc = new ProjectDocument(await openProject(fs));
      rememberProject(projectLocation(fs), doc.project.manifest.data.name);
      setState({ screen: 'project', doc });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState(
        recent
          ? {
              screen: 'start',
              error: `Could not open ${recent}. It may have been moved or deleted.\n${message}`,
              failed: recent,
            }
          : { screen: 'start', error: message },
      );
    }
  };

  /** Run `then` unless the document has unsaved changes the user wants to keep. */
  const leave = async (doc: ProjectDocument, message: string, then: () => void) => {
    if (!doc.dirty || (await confirmDiscard(message))) then();
  };

  switch (state.screen) {
    case 'start':
      return (
        <StartScreen
          error={state.error}
          failed={state.failed ?? null}
          onOpen={(fs, recent) => void open(fs, recent)}
        />
      );
    case 'opening':
      return <div className="centered muted">Opening {state.label}…</div>;
    case 'project': {
      const { doc } = state;
      const close = () =>
        void leave(doc, 'Close the project and lose your unsaved changes?', () =>
          setState({ screen: 'start', error: null }),
        );
      return (
        // A crash inside the project's screens keeps the document: its changes can still be saved.
        <ErrorBoundary key={doc.fs.label} doc={doc} onLeave={close} leaveLabel="Close the project">
          <ProjectView
            doc={doc}
            onClose={close}
            onReload={() =>
              void leave(
                doc,
                'Reload from disk and lose your unsaved changes?',
                () => void open(Promise.resolve(doc.fs)),
              )
            }
          />
        </ErrorBoundary>
      );
    }
  }
}
