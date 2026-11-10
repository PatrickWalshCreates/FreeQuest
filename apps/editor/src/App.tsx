import { type OpenedProject, type ProjectFs, openProject } from '@freequest/editor-core';
import { useState } from 'react';
import { ProjectView } from './ProjectView.js';
import { StartScreen } from './StartScreen.js';

type AppState =
  | { readonly screen: 'start'; readonly error: string | null }
  | { readonly screen: 'opening'; readonly label: string }
  | { readonly screen: 'project'; readonly project: OpenedProject };

export function App() {
  const [state, setState] = useState<AppState>({ screen: 'start', error: null });

  const open = async (pick: Promise<ProjectFs | null>) => {
    try {
      const fs = await pick;
      if (!fs) return;
      setState({ screen: 'opening', label: fs.label });
      setState({ screen: 'project', project: await openProject(fs) });
    } catch (error) {
      setState({ screen: 'start', error: error instanceof Error ? error.message : String(error) });
    }
  };

  switch (state.screen) {
    case 'start':
      return <StartScreen error={state.error} onOpen={(fs) => void open(fs)} />;
    case 'opening':
      return <div className="centered muted">Opening {state.label}…</div>;
    case 'project':
      return (
        <ProjectView
          project={state.project}
          onClose={() => setState({ screen: 'start', error: null })}
          onReload={() => void open(Promise.resolve(state.project.fs))}
        />
      );
  }
}
