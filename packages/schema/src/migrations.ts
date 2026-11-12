import { DATABASE_FORMAT_VERSION } from './database/categories.js';
import { SAVE_FORMAT_VERSION } from './save.js';
import { DATABASE_KINDS, type DatabaseKind } from './manifest.js';
import { CHARACTER_FORMAT_VERSION } from './character.js';
import { MANIFEST_FORMAT_VERSION } from './manifest.js';
import { MAP_FORMAT_VERSION } from './map.js';
import { idFromName } from './common.js';
import { TILESET_FORMAT_VERSION } from './tileset.js';

export type FileKind = 'manifest' | 'tileset' | 'map' | 'character' | 'save' | DatabaseKind;

export const CURRENT_FORMAT_VERSION: Record<FileKind, number> = {
  manifest: MANIFEST_FORMAT_VERSION,
  tileset: TILESET_FORMAT_VERSION,
  map: MAP_FORMAT_VERSION,
  character: CHARACTER_FORMAT_VERSION,
  save: SAVE_FORMAT_VERSION,
  ...(Object.fromEntries(DATABASE_KINDS.map((k) => [k, DATABASE_FORMAT_VERSION])) as Record<
    DatabaseKind,
    number
  >),
};

/** Upgrades a file from version `from` to `from + 1`. Must not mutate its input. */
export interface Migration {
  from: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/** Database v4: every enemy action gets `conditions: []` (always usable, as before). */
function addActionConditions(d: Record<string, unknown>): Record<string, unknown> {
  const entries = Array.isArray(d['entries']) ? (d['entries'] as unknown[]) : [];
  return {
    ...d,
    entries: entries.map((entry) => {
      if (typeof entry !== 'object' || entry === null) return entry;
      const e = entry as Record<string, unknown>;
      const actions = Array.isArray(e['actions']) ? (e['actions'] as unknown[]) : [];
      return {
        ...e,
        actions: actions.map((a) =>
          typeof a === 'object' && a !== null && !('conditions' in a)
            ? { ...a, conditions: [] }
            : a,
        ),
      };
    }),
  };
}

/**
 * Registered migrations per file kind. When bumping a format version, add an
 * entry here (and a test with a fixture of the old format) in the same change.
 */
export const MIGRATIONS: Partial<Record<FileKind, Migration[]>> = {
  manifest: [
    // v2: switch and variable declarations.
    { from: 1, migrate: (d) => ({ ...d, switches: [], variables: [] }) },
    // v3: starting party and gold (the database itself is optional).
    {
      from: 2,
      migrate: (d) => ({ ...d, start: { ...(d['start'] as object), party: [], gold: 0 } }),
    },
    // v4: troops database category. Additive.
    { from: 3, migrate: (d) => d },
    // v5: a permanent game id, made from the name (it keeps saves apart).
    {
      from: 4,
      migrate: (d) => ({
        ...d,
        id: idFromName(typeof d['name'] === 'string' ? d['name'] : '', 'game'),
      }),
    },
    // v6: the common events database category. Additive.
    { from: 5, migrate: (d) => d },
  ],
  tileset: [],
  map: [
    // v2: events.
    { from: 1, migrate: (d) => ({ ...d, events: [] }) },
    // v3: party/gold/item commands and conditions. Additive: v2 maps are valid v3.
    { from: 2, migrate: (d) => d },
    // v4: random encounters and the battle command. Additive.
    { from: 3, migrate: (d) => d },
    // v5: map music and the playMusic/playSound commands. Additive.
    { from: 4, migrate: (d) => d },
    // v6: event page movement. Additive.
    { from: 5, migrate: (d) => d },
    // v7: event flags (the flag condition, setFlag). Additive.
    { from: 6, migrate: (d) => d },
  ],
  character: [],
  // Save v2: event flags (none were set before).
  save: [{ from: 1, migrate: (d) => ({ ...d, flags: {} }) }],
  // Database v2: combat modifiers, troops, attack/guard skills. v3: system audio.
  // Both additive. v4: enemy action conditions (every action gets an empty list).
  ...(Object.fromEntries(
    DATABASE_KINDS.map((k) => [
      k,
      [
        ...[1, 2].map((from) => ({ from, migrate: (d: Record<string, unknown>) => d })),
        {
          from: 3,
          migrate: k === 'enemies' ? addActionConditions : (d: Record<string, unknown>) => d,
        },
      ],
    ]),
  ) as Record<DatabaseKind, Migration[]>),
};

export class FormatVersionError extends Error {
  override name = 'FormatVersionError';
}

/** Bring raw file data up to the current format version of its kind. */
export function migrate(
  kind: FileKind,
  data: unknown,
  migrations: Partial<Record<FileKind, Migration[]>> = MIGRATIONS,
  target: number = CURRENT_FORMAT_VERSION[kind],
): unknown {
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new FormatVersionError(`${kind}: expected a JSON object`);
  }
  let current = data as Record<string, unknown>;
  let version = current['formatVersion'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new FormatVersionError(`${kind}: missing or invalid "formatVersion"`);
  }
  if (version > target) {
    throw new FormatVersionError(
      `${kind}: formatVersion ${version} is newer than this FreeQuest supports (${target})`,
    );
  }
  while (version < target) {
    const step = migrations[kind]?.find((m) => m.from === version);
    if (!step) {
      throw new FormatVersionError(`${kind}: no migration from formatVersion ${version}`);
    }
    current = { ...step.migrate(current), formatVersion: version + 1 };
    version += 1;
  }
  return current;
}
