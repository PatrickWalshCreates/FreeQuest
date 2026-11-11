// The recent projects list, kept in localStorage (the desktop app's
// storage survives restarts). Storage may be unavailable; the list is then
// simply empty.
import {
  type RecentProject,
  type RecentStorage,
  addRecent,
  readRecent,
  removeRecent,
  writeRecent,
} from '@freequest/editor-core';

function storage(): RecentStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadRecent(): readonly RecentProject[] {
  const s = storage();
  return s ? readRecent(s) : [];
}

function update(change: (list: readonly RecentProject[]) => readonly RecentProject[]): void {
  const s = storage();
  if (!s) return;
  try {
    writeRecent(s, change(readRecent(s)));
  } catch {
    // Full or blocked storage: the list just isn't updated.
  }
}

export function rememberProject(location: string, name: string): void {
  update((list) => addRecent(list, { location, name, openedAt: new Date().toISOString() }));
}

export function forgetProject(location: string): void {
  update((list) => removeRecent(list, location));
}
