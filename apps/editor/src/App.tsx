import { ProjectDocument, type ProjectFs, openProject } from '@freequest/editor-core';
import { useState } from 'react';
import { ProjectView } from './ProjectView.js';
import { StartScreen } from './StartScreen.js';
import { confirmDiscard } from './platform.js';

type AppState =
  | { readonly screen: 'start'; readonly error: string | null }
  | { readonly screen: 'opening'; readonly label: string }
  | { readonly screen: 'project'; readonly doc: ProjectDocument };

export function App() {
  const [state, setState] = useState<AppState>({ screen: 'start', error: null });

  const open = async (pick: Promise<ProjectFs | null>) => {
    try {
      const fs = await pick;
      if (!fs) return;
      setState({ screen: 'opening', label: fs.label });
      setState({ screen: 'project', doc: new ProjectDocument(await openProject(fs)) });
    } catch (error) {
      setState({ screen: 'start', error: error instanceof Error ? error.message : String(error) });
    }
  };

  /** Run `then` unless the document has unsaved changes the user wants to keep. */
  const leave = async (doc: ProjectDocument, message: string, then: () => void) => {
    if (!doc.dirty || (await confirmDiscard(message))) then();
  };

  switch (state.screen) {
    case 'start':
      return <StartScreen error={state.error} onOpen={(fs) => void open(fs)} />;
    case 'opening':
      return <div className="centered muted">Opening {state.label}…</div>;
    case 'project': {
      const { doc } = state;
      return (
        <ProjectView
          doc={doc}
          onClose={() =>
            void leave(doc, 'Close the project and lose your unsaved changes?', () =>
              setState({ screen: 'start', error: null }),
            )
          }
          onReload={() =>
            void leave(
              doc,
              'Reload from disk and lose your unsaved changes?',
              () => void open(Promise.resolve(doc.fs)),
            )
          }
        />
      );
    }
  }
}
