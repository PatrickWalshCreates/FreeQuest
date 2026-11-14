// "A new editor is out": a small panel in the corner while an update is
// offered or installing. Installing restarts the editor, so unsaved changes
// are asked about first.
import { FREEQUEST_VERSION } from '@freequest/schema';
import { useSyncExternalStore } from 'react';
import { confirmAction, openExternal } from './platform.js';
import { updates } from './updater.js';

/** The release page, where the version's notes are. */
export const releaseUrl = (version: string) =>
  `https://github.com/PatrickWalshCreates/FreeQuest/releases/tag/v${version}`;

export function UpdateBanner(props: { readonly hasUnsavedChanges: () => boolean }) {
  const state = useSyncExternalStore(updates.subscribe, () => updates.state);
  const shown = useSyncExternalStore(updates.subscribe, () => updates.shown);
  if (!shown) return null;

  if (state.status === 'installing') {
    return (
      <div className="update-banner" role="status">
        <strong>Installing FreeQuest Editor {state.version}…</strong>
        <progress max={1} value={state.progress ?? undefined} />
        <span className="hint">The editor restarts when it’s done.</span>
      </div>
    );
  }
  if (state.status === 'checking') {
    return (
      <div className="update-banner" role="status">
        <strong>Checking for updates…</strong>
      </div>
    );
  }
  if (state.status === 'current' || state.status === 'error') {
    return (
      <div className="update-banner" role="status">
        <strong>
          {state.status === 'current'
            ? `FreeQuest Editor ${FREEQUEST_VERSION} is the newest version`
            : 'Couldn’t check for updates'}
        </strong>
        {state.status === 'error' && (
          <span className="hint">
            {state.message.replace(/\.$/, '')}. Check your internet connection, or download the
            newest version from the website.
          </span>
        )}
        <div className="actions">
          <button type="button" className="primary" onClick={() => updates.later()}>
            OK
          </button>
        </div>
      </div>
    );
  }
  if (state.status !== 'available') return null;

  const install = async () => {
    if (
      props.hasUnsavedChanges() &&
      !(await confirmAction(
        'The editor restarts to install the update, and your unsaved changes would be lost. Install anyway? (Cancel, save, then install.)',
        { title: 'Unsaved changes', okLabel: 'Install and lose changes' },
      ))
    ) {
      return;
    }
    await updates.install();
  };

  return (
    <div className="update-banner" role="status">
      <strong>FreeQuest Editor {state.version} is out</strong>
      <span className="hint">
        Your projects keep working: newer versions open them and upgrade them when you save.
      </span>
      <div className="actions">
        <button type="button" className="primary" onClick={() => void install()}>
          Install and restart
        </button>
        <button type="button" onClick={() => void openExternal(releaseUrl(state.version))}>
          What’s new
        </button>
        <button type="button" onClick={() => updates.later()}>
          Later
        </button>
        <button
          type="button"
          className="link"
          onClick={() => updates.skip()}
          title="Don’t offer this version again"
        >
          Skip this version
        </button>
      </div>
    </div>
  );
}

/** The About page's part: the result of a check, and a button to check now. */
export function UpdateCheck() {
  const state = useSyncExternalStore(updates.subscribe, () => updates.state);
  return (
    <div className="update-check">
      <button
        type="button"
        disabled={state.status === 'checking' || state.status === 'installing'}
        onClick={() => void updates.check(true)}
      >
        Check for updates
      </button>
      <span className="hint">
        {state.status === 'checking'
          ? 'Checking…'
          : state.status === 'current'
            ? 'This is the newest version.'
            : state.status === 'available'
              ? `Version ${state.version} is out: see the panel in the corner.`
              : state.status === 'installing'
                ? `Installing ${state.version}…`
                : state.status === 'error'
                  ? `Couldn’t check: ${state.message}`
                  : 'The editor also checks each time it starts.'}
      </span>
    </div>
  );
}
