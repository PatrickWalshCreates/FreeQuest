import { CHARACTER_FORMAT_VERSION } from './character.js';
import { MANIFEST_FORMAT_VERSION } from './manifest.js';
import { MAP_FORMAT_VERSION } from './map.js';
import { TILESET_FORMAT_VERSION } from './tileset.js';

export type FileKind = 'manifest' | 'tileset' | 'map' | 'character';

export const CURRENT_FORMAT_VERSION: Record<FileKind, number> = {
  manifest: MANIFEST_FORMAT_VERSION,
  tileset: TILESET_FORMAT_VERSION,
  map: MAP_FORMAT_VERSION,
  character: CHARACTER_FORMAT_VERSION,
};

/** Upgrades a file from version `from` to `from + 1`. Must not mutate its input. */
export interface Migration {
  from: number;
  migrate(data: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Registered migrations per file kind. When bumping a format version, add an
 * entry here (and a test with a fixture of the old format) in the same change.
 */
export const MIGRATIONS: Record<FileKind, Migration[]> = {
  manifest: [],
  tileset: [],
  map: [],
  character: [],
};

export class FormatVersionError extends Error {
  override name = 'FormatVersionError';
}

/** Bring raw file data up to the current format version of its kind. */
export function migrate(
  kind: FileKind,
  data: unknown,
  migrations: Record<FileKind, Migration[]> = MIGRATIONS,
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
    const step = migrations[kind].find((m) => m.from === version);
    if (!step) {
      throw new FormatVersionError(`${kind}: no migration from formatVersion ${version}`);
    }
    current = { ...step.migrate(current), formatVersion: version + 1 };
    version += 1;
  }
  return current;
}
