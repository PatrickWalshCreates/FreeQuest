import type { CharacterSheet } from './character.js';
import {
  type Command,
  type Operand,
  type VariableValue,
  strayBreaks,
  walkCommands,
} from './command.js';
import type { IfCondition } from './condition.js';
import type { Database } from './database/checks.js';
import type { Manifest } from './manifest.js';
import type { MoveStep } from './route.js';
import { EMPTY_TILE, type GameMap } from './map.js';
import { parseTextCodes, textCodeReferences } from './text-codes.js';
import type { Tileset } from './tileset.js';

/** All data files of a project, keyed by id. */
export interface ProjectData {
  readonly manifest: Manifest;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly maps: ReadonlyMap<string, GameMap>;
  readonly characters: ReadonlyMap<string, CharacterSheet>;
  readonly database?: Database;
}

/**
 * What reference checks resolve ids against. `maps` holds whichever maps are
 * loaded: a map listed in the manifest but not loaded counts as existing,
 * but positions on it can only be bounds-checked once it is loaded.
 */
export interface ReferenceContext {
  readonly manifest: Manifest;
  readonly tilesets: ReadonlyMap<string, Tileset>;
  readonly characters: ReadonlyMap<string, CharacterSheet>;
  readonly maps?: ReadonlyMap<string, GameMap>;
  /** When given, item, equipment and actor ids used by events are checked too. */
  readonly database?: Database;
}

function makeChecks(ctx: ReferenceContext, problems: string[]) {
  const switches = new Set(ctx.manifest.switches.map((s) => s.id));
  const variables = new Set(ctx.manifest.variables.map((v) => v.id));
  const mapIds = new Set([...ctx.manifest.maps.map((m) => m.id), ...(ctx.maps?.keys() ?? [])]);

  const checkSwitch = (where: string, id: string) => {
    if (!switches.has(id)) problems.push(`${where}: undeclared switch "${id}"`);
  };
  const checkVariable = (where: string, id: string) => {
    if (!variables.has(id)) problems.push(`${where}: undeclared variable "${id}"`);
  };
  const db = ctx.database;
  const dbIds = db && {
    item: new Set(db.items.map((e) => e.id)),
    troop: new Set(db.troops.map((e) => e.id)),
    equipment: new Set(db.equipment.map((e) => e.id)),
    actor: new Set(db.actors.map((e) => e.id)),
    common: new Set(db.commonEvents.map((e) => e.id)),
    state: new Set(db.states.map((e) => e.id)),
    animation: new Set(db.animations.map((e) => e.id)),
  };
  const checkEntry = (
    where: string,
    kind: 'item' | 'equipment' | 'actor' | 'troop' | 'common' | 'state' | 'animation',
    id: string,
  ) => {
    if (dbIds && !dbIds[kind].has(id)) {
      problems.push(`${where}: unknown ${kind === 'common' ? 'common event' : kind} "${id}"`);
    }
  };
  const checkOperand = (where: string, operand: Operand) => {
    if (typeof operand === 'object') checkVariable(where, operand.variable);
  };
  const checkValue = (where: string, value: VariableValue) => {
    if (typeof value !== 'object') return;
    if ('variable' in value) checkVariable(where, value.variable);
    else if ('random' in value) {
      if (value.random.min > value.random.max) {
        problems.push(
          `${where}: random number from ${value.random.min} to ${value.random.max}, but the lowest is above the highest`,
        );
      }
    } else if (value.game.type === 'itemCount') checkEntry(where, value.game.kind, value.game.id);
    else if (value.game.type === 'actorStat') checkEntry(where, 'actor', value.game.actor);
  };
  const checks = {
    checkSwitch,
    checkVariable,
    checkEntry,
    checkOperand,
    /** Route steps that name a character or a switch (v9). */
    checkSteps(where: string, steps: readonly MoveStep[]) {
      steps.forEach((step, i) => {
        if (step.type === 'character' && !ctx.characters.has(step.character)) {
          problems.push(`${where} steps[${i}]: unknown character "${step.character}"`);
        } else if (step.type === 'switch') checkSwitch(`${where} steps[${i}]`, step.switch);
      });
    },
    checkTile(where: string, mapId: string, x: number, y: number) {
      if (!mapIds.has(mapId)) {
        problems.push(`${where}: unknown map "${mapId}"`);
        return;
      }
      const map = ctx.maps?.get(mapId);
      if (map && (x >= map.width || y >= map.height)) {
        problems.push(`${where}: (${x}, ${y}) is outside map "${mapId}"`);
      }
    },
    checkConditions(where: string, conditions: readonly IfCondition[]) {
      for (const c of conditions) {
        if (c.type === 'switch') checkSwitch(where, c.switch);
        else if (c.type === 'variable') checkVariable(where, c.variable);
        else if (c.type === 'hasItem') checkEntry(where, c.kind, c.id);
        else if (c.type === 'inParty' || c.type === 'actorStat' || c.type === 'actorName') {
          checkEntry(where, 'actor', c.actor);
        } else if (c.type === 'actorState') {
          checkEntry(where, 'actor', c.actor);
          checkEntry(where, 'state', c.state);
        }
      }
    },
    /** Text codes in a message, speaker or choice label: their syntax and the ids they name. */
    checkText(where: string, source: string) {
      for (const problem of parseTextCodes(source).problems) problems.push(`${where}: ${problem}`);
      const refs = textCodeReferences(source);
      for (const id of refs.variables) checkVariable(where, id);
      for (const id of refs.actors) checkEntry(where, 'actor', id);
      for (const id of refs.items) checkEntry(where, 'item', id);
      for (const id of refs.equipment) checkEntry(where, 'equipment', id);
    },
    /** Every reference made by a command list (and the lists inside it). */
    checkCommands(commands: readonly Command[], where: string) {
      walkCommands(commands, (command, path) => {
        const at = `${where}.${path}`;
        switch (command.type) {
          case 'message':
            checks.checkText(at, command.text);
            if (command.speaker !== undefined) checks.checkText(`${at} speaker`, command.speaker);
            break;
          case 'choice':
            command.options.forEach((o, i) => checks.checkText(`${at}.options[${i}]`, o.label));
            break;
          case 'if':
            checks.checkConditions(at, command.conditions);
            break;
          case 'setSwitch':
            checkSwitch(at, command.switch);
            break;
          case 'setVariable':
            checkVariable(at, command.variable);
            checkValue(at, command.value);
            break;
          case 'transfer':
            checks.checkTile(at, command.map, command.x, command.y);
            break;
          case 'changeGold':
            checkOperand(at, command.amount);
            break;
          case 'changeItems':
            checkEntry(at, command.kind, command.id);
            checkOperand(at, command.amount);
            break;
          case 'changeParty':
            checkEntry(at, 'actor', command.actor);
            break;
          case 'shop':
            command.goods.forEach((good, g) => checkEntry(`${at}.goods[${g}]`, good.kind, good.id));
            break;
          case 'gainExp':
            if (command.actor !== undefined) checkEntry(at, 'actor', command.actor);
            checkOperand(at, command.amount);
            break;
          case 'recoverAll':
            if (command.actor !== undefined) checkEntry(at, 'actor', command.actor);
            break;
          case 'battle':
            checkEntry(at, 'troop', command.troop);
            break;
          case 'callCommon':
            checkEntry(at, 'common', command.common);
            break;
          case 'moveRoute':
            checks.checkSteps(at, command.steps);
            break;
          case 'showPicture':
          case 'movePicture':
          case 'placeEvent':
            checkOperand(at, command.x);
            checkOperand(at, command.y);
            break;
          case 'changeHp':
          case 'changeMp':
            if (command.actor !== undefined) checkEntry(at, 'actor', command.actor);
            checkOperand(at, command.amount);
            break;
          case 'showAnimation':
            checkEntry(at, 'animation', command.animation);
            break;
          case 'showBalloon': {
            const balloons = db?.system.balloons;
            if (db && !balloons) {
              problems.push(
                `${at}: shows a balloon, but there's no balloon image (Database › System)`,
              );
            } else if (balloons && command.balloon >= balloons.names.length) {
              problems.push(
                `${at}: balloon ${command.balloon} doesn't exist (there are ${balloons.names.length})`,
              );
            }
            break;
          }
          case 'changeState':
            if (command.actor !== undefined) checkEntry(at, 'actor', command.actor);
            checkEntry(at, 'state', command.state);
            break;
          case 'changeActor':
            checkEntry(at, 'actor', command.actor);
            if (command.character !== undefined && !ctx.characters.has(command.character)) {
              problems.push(`${at}: unknown character "${command.character}"`);
            }
            if (command.character === undefined && command.name === undefined) {
              problems.push(`${at}: changes nothing (give a character or a name)`);
            }
            break;
        }
      });
    },
  };
  return checks;
}

/** References made by project.json itself: start position, player character, flag declarations. */
export function checkManifestReferences(ctx: ReferenceContext): string[] {
  const { manifest, characters } = ctx;
  const problems: string[] = [];
  const { checkTile } = makeChecks(ctx, problems);
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
  return problems;
}

/** References made by one map: its tileset, event graphics, flags and transfer targets. */
export function checkMapReferences(map: GameMap, ctx: ReferenceContext): string[] {
  const problems: string[] = [];
  const { checkConditions, checkEntry, checkCommands, checkSteps } = makeChecks(ctx, problems);
  const file = `map "${map.id}"`;
  const tileset = ctx.tilesets.get(map.tileset);
  if (!tileset) problems.push(`${file}: unknown tileset "${map.tileset}"`);
  else {
    // A tile the tileset doesn't have would stop the game (no image, no flags).
    for (const layer of map.layers) {
      const highest = Math.max(
        EMPTY_TILE,
        ...layer.data.map((row) => Math.max(EMPTY_TILE, ...row)),
      );
      if (highest >= tileset.tiles.length) {
        problems.push(
          `${file} layer "${layer.name}": uses tile ${highest}, but tileset "${tileset.id}" has only ${tileset.tiles.length === 1 ? '1 tile' : `${tileset.tiles.length} tiles`}`,
        );
      }
    }
  }
  map.encounters?.troops.forEach((t, i) =>
    checkEntry(`${file} encounters.troops[${i}]`, 'troop', t.troop),
  );
  for (const event of map.events) {
    event.pages.forEach((page, p) => {
      const where = `${file} event "${event.id}" pages[${p}]`;
      checkConditions(where, page.conditions);
      if (page.graphic && !ctx.characters.has(page.graphic.character)) {
        problems.push(`${where}: unknown character "${page.graphic.character}"`);
      }
      if (page.movement?.type === 'route') checkSteps(`${where} movement`, page.movement.steps);
      checkCommands(page.commands, where);
    });
  }
  return problems;
}

/**
 * References made by the common events: their switches and their commands.
 * Commands are checked like a map event's (`this` means whichever event
 * calls them, so there's nothing to check for it).
 */
export function checkCommonEventReferences(ctx: ReferenceContext): string[] {
  const problems: string[] = [];
  const { checkSwitch, checkCommands } = makeChecks(ctx, problems);
  for (const common of ctx.database?.commonEvents ?? []) {
    const where = `commonEvents "${common.id}"`;
    if (common.switch !== undefined) checkSwitch(where, common.switch);
    checkCommands(common.commands, where);
    for (const at of strayBreaks(common.commands)) {
      problems.push(`${where}.${at}: Break loop isn't inside a loop`);
    }
  }
  problems.push(...commonEventCycles(ctx.database?.commonEvents ?? []));
  return problems;
}

/** Commands a battle event can't run (they need the map, or end the battle some other way). */
const NOT_IN_BATTLE = new Set<Command['type']>([
  'transfer',
  'battle',
  'shop',
  'openSave',
  'returnToTitle',
  'gameOver',
  'moveRoute',
  'placeEvent',
  'scrollMap',
]);

/**
 * References made by troops' battle events: their switches and commands, and
 * commands that can't run in a battle.
 */
export function checkTroopEventReferences(ctx: ReferenceContext): string[] {
  const problems: string[] = [];
  const { checkSwitch, checkCommands } = makeChecks(ctx, problems);
  for (const troop of ctx.database?.troops ?? []) {
    troop.events?.forEach((page, p) => {
      const where = `troops "${troop.id}" events[${p}]`;
      if (page.conditions.switch !== undefined) checkSwitch(where, page.conditions.switch);
      checkCommands(page.commands, where);
      walkCommands(page.commands, (command, path) => {
        if (NOT_IN_BATTLE.has(command.type)) {
          problems.push(`${where}.${path}: ${command.type} can't run in a battle event`);
        }
      });
      for (const at of strayBreaks(page.commands)) {
        problems.push(`${where}.${at}: Break loop isn't inside a loop`);
      }
    });
  }
  return problems;
}

/** Common events that end up calling themselves, which would never finish. */
function commonEventCycles(
  commons: readonly { readonly id: string; readonly commands: readonly Command[] }[],
): string[] {
  const calls = new Map<string, string[]>();
  for (const common of commons) {
    const called: string[] = [];
    walkCommands(common.commands, (command) => {
      if (command.type === 'callCommon') called.push(command.common);
    });
    calls.set(common.id, called);
  }
  const problems: string[] = [];
  const reported = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    const start = path.indexOf(id);
    if (start >= 0) {
      const cycle = path.slice(start);
      if (!cycle.some((c) => reported.has(c))) {
        for (const c of cycle) reported.add(c);
        const chain = [...cycle, id].map((c) => `"${c}"`).join(' → ');
        problems.push(`commonEvents "${id}": calls itself (${chain}), so it would never finish`);
      }
      return;
    }
    for (const next of calls.get(id) ?? []) visit(next, [...path, id]);
  };
  for (const id of calls.keys()) visit(id, []);
  return problems;
}

/**
 * Check that every id one file uses to point at another actually exists:
 * tilesets, maps, characters, switches and variables, across a fully loaded
 * project. Returns human-readable problems, each prefixed with its file.
 */
export function checkReferences(project: ProjectData): string[] {
  return [
    ...checkManifestReferences(project),
    ...[...project.maps.values()].flatMap((map) => checkMapReferences(map, project)),
    ...checkCommonEventReferences(project),
    ...checkTroopEventReferences(project),
  ];
}
