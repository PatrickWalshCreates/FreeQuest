// Which projects' plugins the user agreed to run in playtests (M15 step 4).
// Plugins are code. Before a project's plugins first run in a playtest the
// editor asks; the answer is kept per project location and plugin id, so it
// asks again when a plugin the user hasn't agreed to is turned on.
import type { OpenedProject } from './open-project.js';
import type { RecentStorage } from './recent-projects.js';

export const TRUSTED_PLUGINS_KEY = 'freequest:editor:trusted-plugins';
/** Locations remembered; the oldest answers are dropped past this. */
export const MAX_TRUSTED_PROJECTS = 50;

/** Location → plugin ids the user agreed to run. */
export type TrustedPlugins = ReadonlyMap<string, readonly string[]>;

export interface PluginToTrust {
  readonly id: string;
  /** The declaration's name and version, when it loaded. */
  readonly name: string;
  readonly version: string | null;
}

/** The project's turned-on plugins, in manifest order. */
export function enabledPlugins(project: OpenedProject): readonly PluginToTrust[] {
  return (project.manifest.data.plugins ?? [])
    .filter((ref) => ref.enabled)
    .map((ref) => {
      const declaration = project.plugins.get(ref.id)?.data;
      return {
        id: ref.id,
        name: declaration?.name ?? ref.id,
        version: declaration?.version ?? null,
      };
    });
}

/** The turned-on plugins the user hasn't agreed to run for this location. */
export function untrustedPlugins(
  trusted: TrustedPlugins,
  location: string,
  plugins: readonly PluginToTrust[],
): readonly PluginToTrust[] {
  const ids = new Set(trusted.get(location) ?? []);
  return plugins.filter((p) => !ids.has(p.id));
}

/** Remember that the user agreed to run these plugins for this location (newest last). */
export function trustPlugins(
  trusted: TrustedPlugins,
  location: string,
  ids: readonly string[],
): TrustedPlugins {
  const next = new Map(trusted);
  const known = next.get(location) ?? [];
  next.delete(location);
  next.set(location, [...new Set([...known, ...ids])].sort());
  while (next.size > MAX_TRUSTED_PROJECTS) {
    const oldest = next.keys().next().value;
    if (oldest === undefined) break;
    next.delete(oldest);
  }
  return next;
}

/** Read the answers; damaged storage or entries are skipped (so the editor asks again). */
export function readTrustedPlugins(storage: RecentStorage): TrustedPlugins {
  let parsed: unknown;
  try {
    parsed = JSON.parse(storage.getItem(TRUSTED_PLUGINS_KEY) ?? '[]');
  } catch {
    return new Map();
  }
  const result = new Map<string, readonly string[]>();
  if (!Array.isArray(parsed)) return result;
  for (const entry of parsed as unknown[]) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [location, ids] = entry as [unknown, unknown];
    if (typeof location !== 'string' || location === '' || !Array.isArray(ids)) continue;
    result.set(
      location,
      (ids as unknown[]).filter((id): id is string => typeof id === 'string'),
    );
  }
  return result;
}

export function writeTrustedPlugins(storage: RecentStorage, trusted: TrustedPlugins): void {
  storage.setItem(TRUSTED_PLUGINS_KEY, JSON.stringify([...trusted]));
}
