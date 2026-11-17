// Asked before a project's plugins first run in a playtest (M15 step 4).
import {
  type PluginToTrust,
  type RecentStorage,
  type TrustedPlugins,
  readTrustedPlugins,
  trustPlugins,
  writeTrustedPlugins,
} from '@freequest/editor-core';
import { Dialog } from './Dialog.js';

function storage(): RecentStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** The plugins the user agreed to run, per project location (empty without storage). */
export function loadTrustedPlugins(): TrustedPlugins {
  const s = storage();
  return s ? readTrustedPlugins(s) : new Map();
}

/** Remember the user's yes (only for this session if storage is unavailable). */
export function rememberTrust(location: string, ids: readonly string[]): void {
  const s = storage();
  if (!s) return;
  try {
    writeTrustedPlugins(s, trustPlugins(readTrustedPlugins(s), location, ids));
  } catch {
    // Storage full or blocked: the editor will simply ask again next time.
  }
}

interface Props {
  readonly plugins: readonly PluginToTrust[];
  /** `true`: run them (and don't ask again); `false`: play without plugins. */
  readonly onAnswer: (run: boolean) => void;
  readonly onCancel: () => void;
}

export function PluginTrustDialog({ plugins, onAnswer, onCancel }: Props) {
  return (
    <Dialog title="Run this project’s plugins?" onClose={onCancel}>
      <p>This project runs code from {plugins.length === 1 ? 'a plugin' : 'plugins'}:</p>
      <ul>
        {plugins.map((p) => (
          <li key={p.id}>
            <strong>{p.name}</strong>{' '}
            <span className="muted">
              ({p.id}
              {p.version ? ` ${p.version}` : ''})
            </span>
          </li>
        ))}
      </ul>
      <p className="muted">
        Plugins are JavaScript. In a playtest they run in a sandbox, away from your files and the
        editor, but they can still do anything a web page can in that sandbox, such as using a lot
        of memory or processor time. Only run plugins you trust or wrote yourself. The editor
        remembers your answer for this project.
      </p>
      <div className="actions">
        <button onClick={onCancel}>Cancel</button>
        <button onClick={() => onAnswer(false)}>Play without plugins</button>
        <button className="primary" onClick={() => onAnswer(true)}>
          Run plugins
        </button>
      </div>
    </Dialog>
  );
}
