import type { Static, TSchema } from 'typebox';
import Value from 'typebox/value';
import { CharacterSheet } from './character.js';
import { SaveFile } from './save.js';
import {
  ActorsFile,
  ClassesFile,
  EnemiesFile,
  EquipmentFile,
  ItemsFile,
  SkillsFile,
  StatesFile,
  SystemData,
  TroopsFile,
  CommonEventsFile,
} from './database/index.js';
import { strayBreaks, walkCommands } from './command.js';
import { Manifest } from './manifest.js';
import { GameMap } from './map.js';
import { type FileKind, migrate } from './migrations.js';
import { Tileset } from './tileset.js';

export const SCHEMAS = {
  manifest: Manifest,
  tileset: Tileset,
  map: GameMap,
  character: CharacterSheet,
  save: SaveFile,
  system: SystemData,
  actors: ActorsFile,
  classes: ClassesFile,
  skills: SkillsFile,
  items: ItemsFile,
  equipment: EquipmentFile,
  states: StatesFile,
  enemies: EnemiesFile,
  troops: TroopsFile,
  commonEvents: CommonEventsFile,
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

/** Frames a character sheet refers to must exist (the game would stop drawing it otherwise). */
export function checkCharacterShape(sheet: CharacterSheet): string[] {
  const problems: string[] = [];
  if (sheet.idleFrame >= sheet.frames) {
    problems.push(`standing frame ${sheet.idleFrame} is past the last frame (${sheet.frames - 1})`);
  }
  const bad = [...new Set(sheet.walkCycle.filter((f) => f >= sheet.frames))];
  if (bad.length > 0) {
    problems.push(
      `walk cycle uses frame${bad.length === 1 ? '' : 's'} ${bad.join(', ')}, past the last frame (${sheet.frames - 1})`,
    );
  }
  return problems;
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
  const seen = new Set<string>();
  map.events.forEach((event, i) => {
    const where = `events[${i}] "${event.id}"`;
    if (seen.has(event.id)) problems.push(`${where}: duplicate event id`);
    seen.add(event.id);
    if (event.x >= map.width || event.y >= map.height) {
      problems.push(`${where}: position (${event.x}, ${event.y}) is outside the map`);
    }
    event.pages.forEach((page, p) => {
      for (const at of strayBreaks(page.commands)) {
        problems.push(`${where} pages[${p}].${at}: Break loop isn't inside a loop`);
      }
      walkCommands(page.commands, (command, path) => {
        if (command.type === 'choice' && command.cancel !== undefined) {
          if (command.cancel >= command.options.length) {
            problems.push(
              `${where} pages[${p}].${path}: cancel index ${command.cancel} has no option`,
            );
          }
        }
        if (command.type === 'moveRoute') {
          const at = `${where} pages[${p}].${path}`;
          if (command.repeat && command.wait) {
            problems.push(`${at}: a repeating route never ends, so the event can't wait for it`);
          }
          const target = command.target;
          if (
            target !== 'player' &&
            target !== 'this' &&
            !map.events.some((e) => e.id === target)
          ) {
            problems.push(`${at}: route for "${target}", which isn't an event on this map`);
          }
        }
        if (command.type === 'setFlag' && command.event !== undefined) {
          const other = command.event;
          if (!map.events.some((e) => e.id === other)) {
            problems.push(
              `${where} pages[${p}].${path}: flag of "${other}", which isn't an event on this map`,
            );
          }
        }
      });
    });
  });
  return problems;
}
