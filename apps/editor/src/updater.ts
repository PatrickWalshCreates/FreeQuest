// Editor updates (desktop only): ask the latest GitHub release whether a
// newer editor exists, then download, install and restart on request. The
// updater plugin checks every file against FreeQuest's public update key.
// One store for the whole app, so the banner and the About page agree.
import { SKIPPED_UPDATE_KEY, shouldOfferUpdate } from '@freequest/editor-core';
import { FREEQUEST_VERSION } from '@freequest/schema';
import type { Update } from '@tauri-apps/plugin-updater';
import { IN_DESKTOP_APP } from './platform.js';

export type UpdateState =
  | { readonly status: 'idle' }
  | { readonly status: 'checking' }
  /** Checked: this is the newest editor. */
  | { readonly status: 'current' }
  | { readonly status: 'available'; readonly version: string; readonly notes: string }
  | {
      readonly status: 'installing';
      readonly version: string;
      /** 0–1 once the download size is known. */
      readonly progress: number | null;
    }
  | { readonly status: 'error'; readonly message: string };

let state: UpdateState = { status: 'idle' };
/** The update found, kept to install it (not part of the state React sees). */
let found: Update | null = null;
/** The panel hides after "Later" (or OK) until the next check. */
let dismissed = false;
/** The last check was asked for (menu, Help, start screen): show its result whatever it is. */
let manual = false;
const listeners = new Set<() => void>();

const set = (next: UpdateState) => {
  state = next;
  for (const listener of listeners) listener();
};

export const updates = {
  get state(): UpdateState {
    return state;
  },
  /** Whether the corner panel shows: an offer, an install, or a check someone asked for. */
  get shown(): boolean {
    if (dismissed) return false;
    return (
      state.status === 'available' ||
      state.status === 'installing' ||
      (manual && state.status !== 'idle')
    );
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Look for a newer editor. At start (`manual` false) a skipped version and
   * any error stay quiet; from the About page every outcome is shown.
   */
  async check(isManual: boolean): Promise<void> {
    if (!IN_DESKTOP_APP || state.status === 'checking' || state.status === 'installing') return;
    manual = manual || isManual;
    dismissed = false;
    set({ status: 'checking' });
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check({ timeout: 30_000 });
      const skipped = isManual ? null : readSkipped();
      if (update && shouldOfferUpdate(FREEQUEST_VERSION, update.version, skipped)) {
        found = update;
        set({ status: 'available', version: update.version, notes: update.body ?? '' });
      } else {
        found = null;
        set(isManual ? { status: 'current' } : { status: 'idle' });
      }
    } catch (error) {
      found = null;
      set(isManual ? { status: 'error', message: describe(error) } : { status: 'idle' });
    }
  },

  /** Download and install the offered update, then restart into it. */
  async install(): Promise<void> {
    const update = found;
    if (!update || state.status !== 'available') return;
    const version = update.version;
    set({ status: 'installing', version, progress: null });
    try {
      let total = 0;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') total = event.data.contentLength ?? 0;
        if (event.event === 'Progress') {
          received += event.data.chunkLength;
          set({ status: 'installing', version, progress: total > 0 ? received / total : null });
        }
      });
      // Windows' installer closes the editor by itself; elsewhere, restart into the new version.
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (error) {
      set({ status: 'error', message: `The update couldn't be installed: ${describe(error)}` });
    }
  },

  /** Don't offer this version again (a newer one will still be offered). */
  skip(): void {
    if (state.status !== 'available') return;
    try {
      localStorage.setItem(SKIPPED_UPDATE_KEY, state.version);
    } catch {
      // Storage can be unavailable; the offer just comes back next time.
    }
    dismissed = true;
    set(state);
  },

  /** Hide the panel until the next check. */
  later(): void {
    dismissed = true;
    manual = false;
    set(state);
  },
};

function readSkipped(): string | null {
  try {
    return localStorage.getItem(SKIPPED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text || 'unknown error';
}
