// Reading an RPG Maker MZ project folder. MZ keeps its data as plain JSON in
// data/; this reads only the fields the importer uses, leniently, into our own
// shapes. (Clean-room: the JSON field names are MZ's file format, read for
// interoperability; everything else here is FreeQuest's own.)
import { FileNotFoundError, type ProjectFs } from '@freequest/editor-core';
import { asArray, asInt, asRecord, asString, isRecord, numberedNames } from './json.js';
import type { ImportReport } from './report.js';

/** The project file MZ's editor opens; its presence tells MZ from MV. */
export const MZ_PROJECT_FILE = 'game.rmmzproject';
const MV_PROJECT_FILE = 'Game.rpgproject';
const SYSTEM_FILE = 'data/System.json';
const MAP_INFOS_FILE = 'data/MapInfos.json';

/** The folder isn't an MZ project, or its system file can't be read. */
export class MzProjectError extends Error {
  override name = 'MzProjectError';
}

/** Names numbered from 1, position 0 unused (see `numberedNames`). */
export type NumberedNames = readonly string[];

export interface MzSystem {
  readonly title: string;
  readonly currency: string;
  readonly elements: NumberedNames;
  readonly skillTypes: NumberedNames;
  readonly weaponTypes: NumberedNames;
  readonly armorTypes: NumberedNames;
  /** Equipment slots, in menu order. */
  readonly equipTypes: NumberedNames;
  readonly switches: NumberedNames;
  readonly variables: NumberedNames;
  /** Tile size in pixels (48 unless the project changed it). */
  readonly tileSize: number;
  /** The game's screen size in pixels. */
  readonly screen: { readonly width: number; readonly height: number };
  readonly start: { readonly map: number; readonly x: number; readonly y: number };
  /** Actor numbers of the starting party. */
  readonly party: readonly number[];
  /** Side-view battles (enemy images in img/sv_enemies). */
  readonly sideView: boolean;
  /** The player starts transparent (hidden). */
  readonly startHidden: boolean;
  /** The title screen's background and frame pictures (img/titles1, img/titles2; '' = none). */
  readonly titleScreen: {
    readonly background: string;
    readonly frame: string;
    readonly showName: boolean;
  };
}

export interface MzMapInfo {
  readonly id: number;
  readonly name: string;
  /** 0 for a top-level map. */
  readonly parent: number;
  readonly order: number;
}

/** A plugin listed in the MZ project's js/plugins.js (read as data, never run). */
export interface MzPlugin {
  readonly name: string;
  readonly on: boolean;
}

export const MZ_PLUGINS_FILE = 'js/plugins.js';

/**
 * The plugins js/plugins.js lists, or null without one. The file is a script
 * that assigns one JSON array (`var $plugins = [...];`): only that array is
 * read, as JSON. Anything else reads as no plugins, with a note.
 */
export async function readMzPlugins(
  fs: ProjectFs,
  report: ImportReport,
): Promise<readonly MzPlugin[] | null> {
  let text: string;
  try {
    text = await fs.readText(MZ_PLUGINS_FILE);
  } catch (error) {
    if (error instanceof FileNotFoundError) return null;
    throw error;
  }
  const start = text.indexOf('[', Math.max(0, text.indexOf('$plugins')));
  const end = text.lastIndexOf(']');
  let list: unknown;
  try {
    list = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : null;
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) {
    report.note(
      'Plugins',
      `${MZ_PLUGINS_FILE} couldn't be read, so the plugins the game used aren't listed.`,
    );
    return [];
  }
  return list.flatMap((entry) => {
    const record = asRecord(entry);
    const name = asString(record['name']).trim();
    return name ? [{ name, on: record['status'] === true }] : [];
  });
}

/** Report the MZ plugins a game used: FreeQuest doesn't run them. */
export function reportMzPlugins(plugins: readonly MzPlugin[], report: ImportReport): void {
  const on = plugins.filter((p) => p.on).map((p) => p.name);
  const off = plugins.filter((p) => !p.on).map((p) => p.name);
  if (on.length === 0 && off.length === 0) return;
  const parts = [
    on.length > 0
      ? `The game used ${on.length} MZ ${on.length === 1 ? 'plugin' : 'plugins'}: ${on.join(', ')}.`
      : 'The game turned on no MZ plugins.',
    off.length > 0 ? `Turned off: ${off.join(', ')}.` : '',
    "FreeQuest doesn't run MZ plugins (JavaScript written for RPG Maker). Their commands are comments in the events, listed as “Plugin command (name)”; a FreeQuest plugin can do what one did.",
  ];
  report.missing(
    'Plugins',
    parts.filter(Boolean).join(' '),
    on.length > 0 ? [{ name: 'MZ plugins (turned on)', count: on.length }] : [],
  );
}

export interface MzProject {
  readonly system: MzSystem;
  /** Every map the project lists, in the editor's order. */
  readonly maps: readonly MzMapInfo[];
}

const DEFAULT_TILE_SIZE = 48;
const DEFAULT_SCREEN = { width: 816, height: 624 };

/** Read a data file as JSON, or null when it doesn't exist. Broken JSON throws. */
export async function readMzJson(fs: ProjectFs, path: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readText(path);
  } catch (error) {
    if (error instanceof FileNotFoundError) return null;
    throw error;
  }
  try {
    // MZ writes a byte-order mark in some files.
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch (error) {
    throw new MzProjectError(
      `${path} isn't valid JSON (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
}

async function exists(fs: ProjectFs, path: string): Promise<boolean> {
  try {
    await fs.readBytes(path);
    return true;
  } catch (error) {
    if (error instanceof FileNotFoundError) return false;
    throw error;
  }
}

/** Read the project's system settings and map list. */
export async function readMzProject(fs: ProjectFs, report: ImportReport): Promise<MzProject> {
  const raw = await readMzJson(fs, SYSTEM_FILE);
  if (!isRecord(raw)) {
    throw new MzProjectError(
      raw === null
        ? "This folder isn't an RPG Maker MZ project: it has no data/System.json. Choose the folder that holds game.rmmzproject."
        : `${SYSTEM_FILE} doesn't hold the project's settings.`,
    );
  }
  if (!(await exists(fs, MZ_PROJECT_FILE))) {
    report.note(
      'Project',
      (await exists(fs, MV_PROJECT_FILE))
        ? 'This is an RPG Maker MV project. It was imported like an MZ project, which may miss things MV does differently.'
        : `There's no ${MZ_PROJECT_FILE} in the folder; it was imported as an MZ project.`,
    );
  }
  const system = readSystem(raw);
  if (system.title === '')
    report.note('Project', 'The game has no title; it is called "Imported game".');

  const infos = await readMzJson(fs, MAP_INFOS_FILE);
  if (infos === null)
    report.missing('Maps', 'data/MapInfos.json is missing, so no maps were found.');
  return { system, maps: readMapInfos(infos) };
}

function readSystem(raw: Readonly<Record<string, unknown>>): MzSystem {
  const advanced = asRecord(raw['advanced']);
  const width = asInt(advanced['screenWidth'], DEFAULT_SCREEN.width);
  const height = asInt(advanced['screenHeight'], DEFAULT_SCREEN.height);
  const tileSize = asInt(raw['tileSize'], DEFAULT_TILE_SIZE);
  return {
    title: asString(raw['gameTitle']).trim(),
    currency: asString(raw['currencyUnit']).trim(),
    elements: numberedNames(raw['elements']),
    skillTypes: numberedNames(raw['skillTypes']),
    weaponTypes: numberedNames(raw['weaponTypes']),
    armorTypes: numberedNames(raw['armorTypes']),
    equipTypes: numberedNames(raw['equipTypes']),
    switches: numberedNames(raw['switches']),
    variables: numberedNames(raw['variables']),
    tileSize: tileSize > 0 ? tileSize : DEFAULT_TILE_SIZE,
    screen: width > 0 && height > 0 ? { width, height } : DEFAULT_SCREEN,
    start: {
      map: asInt(raw['startMapId']),
      x: Math.max(0, asInt(raw['startX'])),
      y: Math.max(0, asInt(raw['startY'])),
    },
    sideView: raw['optSideView'] === true,
    startHidden: raw['optTransparent'] === true,
    titleScreen: {
      background: asString(raw['title1Name']).trim(),
      frame: asString(raw['title2Name']).trim(),
      showName: raw['optDrawTitle'] !== false,
    },
    party: asArray(raw['partyMembers'])
      .map((v) => asInt(v))
      .filter((n) => n > 0),
  };
}

function readMapInfos(raw: unknown): MzMapInfo[] {
  const maps: MzMapInfo[] = [];
  for (const entry of asArray(raw)) {
    if (!isRecord(entry)) continue; // position 0, and deleted maps, are null
    const id = asInt(entry['id']);
    if (id <= 0) continue;
    maps.push({
      id,
      name: asString(entry['name']).trim(),
      parent: asInt(entry['parentId']),
      order: asInt(entry['order']),
    });
  }
  return maps.sort((a, b) => a.order - b.order || a.id - b.id);
}
