// The editor's recent projects: newest first, one entry per location, kept
// in whatever key-value storage the platform has (localStorage in the app).
// A location is whatever the platform reopens a project from: a folder
// path on the desktop, "<area>/<name>" in browser mode.

export interface RecentProject {
  /** Where the project is (see above). */
  readonly location: string;
  /** The game's name when it was last opened. */
  readonly name: string;
  /** ISO timestamp of the last open. */
  readonly openedAt: string;
}

/** The part of Storage the list needs. */
export interface RecentStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const RECENT_PROJECTS_KEY = 'freequest:editor:recent';
export const MAX_RECENT_PROJECTS = 10;

/** Put `entry` first, dropping an older entry for the same location. */
export function addRecent(
  list: readonly RecentProject[],
  entry: RecentProject,
): readonly RecentProject[] {
  return [entry, ...list.filter((p) => p.location !== entry.location)].slice(
    0,
    MAX_RECENT_PROJECTS,
  );
}

export function removeRecent(
  list: readonly RecentProject[],
  location: string,
): readonly RecentProject[] {
  return list.filter((p) => p.location !== location);
}

function isRecent(value: unknown): value is RecentProject {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.location === 'string' &&
    v.location !== '' &&
    typeof v.name === 'string' &&
    typeof v.openedAt === 'string'
  );
}

/** Read the list; damaged storage or entries are skipped, never fatal. */
export function readRecent(storage: RecentStorage): readonly RecentProject[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(RECENT_PROJECTS_KEY) ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const list: RecentProject[] = [];
  for (const item of parsed) {
    if (!isRecent(item) || seen.has(item.location)) continue;
    seen.add(item.location);
    list.push({ location: item.location, name: item.name, openedAt: item.openedAt });
  }
  return list.slice(0, MAX_RECENT_PROJECTS);
}

export function writeRecent(storage: RecentStorage, list: readonly RecentProject[]): void {
  storage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(list));
}
