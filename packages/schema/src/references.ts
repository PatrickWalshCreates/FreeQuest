import type { CharacterSheet } from './character.js';
import { walkCommands } from './command.js';
import type { Condition } from './condition.js';
import type { Manifest } from './manifest.js';
import type { GameMap } from './map.js';
import type { Tileset } from './tileset.js';

/** All data files of a project, keyed by id. */
export interface ProjectData {
  readonly manifest: Manifest;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly maps: ReadonlyMap<string, GameMap>;
  readonly characters: ReadonlyMap<string, CharacterSheet>;
}

/**
 * Check that every id one file uses to point at another actually exists:
 * tilesets, maps, characters, switches and variables. Returns human-readable
 * problems, each prefixed with the file it was found in.
 */
export function checkReferences(project: ProjectData): string[] {
  const { manifest, tilesets, maps, characters } = project;
  const problems: string[] = [];
  const switches = new Set(manifest.switches.map((s) => s.id));
  const variables = new Set(manifest.variables.map((v) => v.id));

  const checkTile = (where: string, mapId: string, x: number, y: number) => {
    const map = maps.get(mapId);
    if (!map) problems.push(`${where}: unknown map "${mapId}"`);
    else if (x >= map.width || y >= map.height) {
      problems.push(`${where}: (${x}, ${y}) is outside map "${mapId}"`);
    }
  };
  const checkSwitch = (where: string, id: string) => {
    if (!switches.has(id)) problems.push(`${where}: undeclared switch "${id}"`);
  };
  const checkVariable = (where: string, id: string) => {
    if (!variables.has(id)) problems.push(`${where}: undeclared variable "${id}"`);
  };
  const checkConditions = (where: string, conditions: readonly Condition[]) => {
    for (const c of conditions) {
      if (c.type === 'switch') checkSwitch(where, c.switch);
      else checkVariable(where, c.variable);
    }
  };

  checkTile('project.json start', manifest.start.map, manifest.start.x, manifest.start.y);
  if (!characters.has(manifest.player.character)) {
    problems.push(`project.json player: unknown character "${manifest.player.character}"`);
  }
  for (const [kind, list] of [
    ['switch', manifest.switches],
    ['variable', manifest.variables],
  ] as const) {
    const ids = new Set<string>();
    for (const { id } of list) {
      if (ids.has(id)) problems.push(`project.json: duplicate ${kind} "${id}"`);
      ids.add(id);
    }
  }

  for (const map of maps.values()) {
    const file = `map "${map.id}"`;
    if (!tilesets.has(map.tileset)) problems.push(`${file}: unknown tileset "${map.tileset}"`);
    for (const event of map.events) {
      event.pages.forEach((page, p) => {
        const where = `${file} event "${event.id}" pages[${p}]`;
        checkConditions(where, page.conditions);
        if (page.graphic && !characters.has(page.graphic.character)) {
          problems.push(`${where}: unknown character "${page.graphic.character}"`);
        }
        walkCommands(page.commands, (command, path) => {
          const at = `${where}.${path}`;
          switch (command.type) {
            case 'if':
              checkConditions(at, command.conditions);
              break;
            case 'setSwitch':
              checkSwitch(at, command.switch);
              break;
            case 'setVariable':
              checkVariable(at, command.variable);
              if (typeof command.value === 'object') checkVariable(at, command.value.variable);
              break;
            case 'transfer':
              checkTile(at, command.map, command.x, command.y);
              break;
          }
        });
      });
    }
  }
  return problems;
}
