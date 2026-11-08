import type { Static, TSchema } from 'typebox';
import Value from 'typebox/value';
import { CharacterSheet } from './character.js';
import { Manifest } from './manifest.js';
import { GameMap } from './map.js';
import { type FileKind, migrate } from './migrations.js';
import { Tileset } from './tileset.js';

export const SCHEMAS = {
  manifest: Manifest,
  tileset: Tileset,
  map: GameMap,
  character: CharacterSheet,
} satisfies Record<FileKind, TSchema>;

export type FileData<K extends FileKind> = Static<(typeof SCHEMAS)[K]>;

export class ProjectFileError extends Error {
  override name = 'ProjectFileError';
  constructor(
    readonly source: string,
    readonly problems: string[],
  ) {
    super(`${source}:\n  ${problems.join('\n  ')}`);
  }
}

/**
 * Migrate raw JSON to the current format, then validate it against the
 * schema. `source` names the file in error messages.
 */
export function parseProjectFile<K extends FileKind>(
  kind: K,
  raw: unknown,
  source: string = kind,
): FileData<K> {
  const data = migrate(kind, raw);
  const schema: TSchema = SCHEMAS[kind];
  if (Value.Check(schema, data)) {
    return data as FileData<K>;
  }
  const problems = [...Value.Errors(schema, data)].map(
    (e) => `${e.instancePath || '/'}: ${e.message}`,
  );
  throw new ProjectFileError(source, problems);
}

/** Structural checks the JSON Schema cannot express (e.g. layer sizes match the map). */
export function checkMapShape(map: GameMap): string[] {
  const problems: string[] = [];
  map.layers.forEach((layer, i) => {
    if (layer.data.length !== map.height) {
      problems.push(
        `layers[${i}] "${layer.name}" has ${layer.data.length} rows, expected ${map.height}`,
      );
    }
    layer.data.forEach((row, y) => {
      if (row.length !== map.width) {
        problems.push(`layers[${i}] row ${y} has ${row.length} tiles, expected ${map.width}`);
      }
    });
  });
  return problems;
}
