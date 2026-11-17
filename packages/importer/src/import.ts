// Importing an MZ project: read it, then write a new FreeQuest project into an
// empty folder. The MZ folder is only ever read. Whatever the importer doesn't
// make itself (yet) comes from a template (the Starter), so the result always
// opens and plays. project.json is written last, so an interrupted import
// never looks like a finished project.
import { AnimationImporter } from './animations.js';
import {
  MANIFEST_PATH,
  type ProjectFs,
  TEMPLATE_INFO_FILE,
  type TemplateSource,
  decodeUtf8,
  newProjectProblem,
  suggestGameId,
  uniqueId,
} from '@freequest/editor-core';
import {
  DATABASE_KINDS,
  type DatabaseKind,
  type Manifest,
  type FlagDeclaration,
  type SystemData,
  stableStringify,
} from '@freequest/schema';
import { entriesFile, importDatabase, systemData } from './database.js';
import type { ImageCodec } from './image.js';
import { GraphicsImporter } from './graphics.js';
import { importMaps } from './import-maps.js';
import { AudioImporter } from './audio.js';
import {
  type EventsContext,
  convertCommonEvents,
  convertMapEvents,
  convertTroopEvents,
} from './events.js';
import { asArray, asInt, asRecord, asString, isRecord } from './json.js';
import { systemAudio } from './system-audio.js';
import { readMzDatabase } from './mz-lists.js';
import { SystemTypes } from './system-types.js';
import { NumberedIds } from './ids.js';
import { readMzJson, readMzPlugins, readMzProject, reportMzPlugins } from './mz-project.js';
import { ImportReport } from './report.js';

/** The report's file in the new project. */
export const IMPORT_REPORT_FILE = 'IMPORT-REPORT.md';

export interface ImportOptions {
  /** Where anything not imported comes from (the Starter template). */
  readonly template: TemplateSource;
  /** The new game's name (default: the MZ game's title). */
  readonly name?: string;
  /** The new game's id (default: from the name). */
  readonly id?: string;
  /** Decodes the MZ project's PNGs and encodes the generated ones. */
  readonly images: ImageCodec;
  readonly onProgress?: (done: number, total: number) => void;
}

export interface ImportResult {
  readonly name: string;
  readonly id: string;
  readonly report: ImportReport;
}

/** Import the MZ project in `source` into the empty folder `target`. */
export async function importMzProject(
  source: ProjectFs,
  target: ProjectFs,
  options: ImportOptions,
): Promise<ImportResult> {
  const report = new ImportReport();
  const mz = await readMzProject(source, report);
  // The MZ plugins it used are listed in the report; they never come across or run.
  const mzPlugins = await readMzPlugins(source, report);
  if (mzPlugins) reportMzPlugins(mzPlugins, report);
  const name = options.name?.trim() || mz.system.title || 'Imported game';
  const id = options.id ?? suggestGameId(name);
  const problem = newProjectProblem({ name, id });
  if (problem) throw new Error(problem);
  if ((await target.list('')).length > 0) {
    throw new Error('Choose an empty folder for the imported project');
  }

  if (!options.template.files.includes(MANIFEST_PATH)) {
    throw new Error('The template has no project.json');
  }
  const readTemplate = async (path: string) =>
    JSON.parse(decodeUtf8(await options.template.read(path))) as Record<string, unknown>;
  const manifest = (await readTemplate(MANIFEST_PATH)) as unknown as Manifest;

  // Switches and variables share one id space in FreeQuest.
  const gameStateIds = new Set<string>();
  const switches = new NumberedIds(mz.system.switches, 'switch', gameStateIds);
  const variables = new NumberedIds(mz.system.variables, 'variable', gameStateIds);
  const types = new SystemTypes(mz.system);

  // The database, written over the template's.
  const db = await readMzDatabase(source);

  // Pictures: actors' characters and enemies' images, made as they're needed.
  const graphics = new GraphicsImporter(source, options.images, report, mz.system.sideView);
  const actorCharacters = new Map<number, string>();
  for (const actor of db.actors) {
    const character = await graphics.character(
      asString(actor.entry['characterName']),
      asInt(actor.entry['characterIndex']),
      `Actors › ${actor.name}`,
    );
    if (character) actorCharacters.set(actor.n, character);
  }
  const enemyImages = new Map<number, string>();
  for (const enemy of db.enemies) {
    const image = await graphics.enemy(
      asString(enemy.entry['battlerName']),
      `Enemies › ${enemy.name}`,
    );
    if (image) enemyImages.set(enemy.n, image);
  }
  const commonRaw = await readMzJson(source, 'data/CommonEvents.json');
  const commonIds = new NumberedIds(
    asArray(commonRaw).map((e, n) => (n > 0 && isRecord(e) ? asString(e['name']).trim() : '')),
    'common',
    new Set(),
  );
  let placeholderUsed = false;
  // Animations: stand-ins for the ones skills, items and events use.
  const animations = new AnimationImporter(db.animations);
  const imported = importDatabase({
    animation: (n) => animations.use(n),
    common: (n) => (hasCommonEvent(commonRaw, n) ? commonIds.id(n) : null),
    db,
    types,
    variables,
    report,
    actorCharacter: (n) => actorCharacters.get(n) ?? null,
    enemyImage: (n) => enemyImages.get(n) ?? null,
    placeholderCharacter: manifest.player.character,
    usedPlaceholder: () => {
      placeholderUsed = true;
    },
  });
  // MZ's player looks like the party's first member.
  const party = mz.system.party.flatMap((n) => db.actors.id(n) ?? []);
  const firstActor = imported.actors[0];
  if (party.length === 0 && firstActor) party.push(firstActor.id);
  const leader = imported.actors.find((a) => a.id === party[0]);
  const playerCharacter = leader?.character ?? manifest.player.character;
  if (!leader) placeholderUsed = true;
  const databasePaths = { ...DEFAULT_DATABASE_PATHS, ...manifest.database };
  const templateSystem = (await readTemplate(databasePaths.system)) as unknown as SystemData;

  // Maps, and a tileset for each MZ tileset they use.
  const maps = await importMaps(source, mz, db, report, options.images);

  // Events, once every map exists (transfers need their targets).
  const extraSwitches: FlagDeclaration[] = [];
  const audio = new AudioImporter(source, report);
  let redo: string | null = null;
  const mapById = new Map(maps.maps.map((m) => [m.mzId, m.data]));
  const events: EventsContext = {
    report,
    graphics,
    audio,
    db,
    switches,
    variables,
    map: (n) => mapById.get(n)?.id ?? null,
    mapSize: (mapId) => maps.maps.find((m) => m.data.id === mapId)?.data ?? null,
    common: (n) => (hasCommonEvent(commonRaw, n) ? commonIds.id(n) : null),
    textColor: await graphics.textColors(),
    animation: (n) => animations.use(n),
    redoSwitch: () => {
      if (!redo) {
        redo = uniqueId('imported-condition-to-redo', gameStateIds);
        gameStateIds.add(redo);
        extraSwitches.push({ id: redo, name: 'Imported: condition to redo' });
      }
      return redo;
    },
  };
  let unspecifiedBattlebacks = 0;
  for (const map of maps.maps) {
    const mapEvents = await convertMapEvents(
      {
        raw: map.raw,
        mapWhere: map.where,
        drawer: map.drawer,
        width: map.data.width,
        height: map.data.height,
      },
      events,
    );
    // Map music and background sound (when MZ plays them automatically).
    const bgm = asString(asRecord(map.raw['bgm'])['name']).trim();
    const music = map.raw['autoplayBgm'] === true ? await audio.sound('bgm', bgm, map.where) : null;
    const bgs = asString(asRecord(map.raw['bgs'])['name']).trim();
    const backgroundSound =
      map.raw['autoplayBgs'] === true && bgs ? await audio.sound('bgs', bgs, map.where) : null;
    // The map's own battle background, when MZ's map names one (otherwise MZ picks one from
    // the ground under the party, which FreeQuest doesn't: the project's is used).
    const battleBackground =
      map.raw['specifyBattleback'] === true
        ? await graphics.battleback(
            asString(map.raw['battleback1Name']).trim(),
            asString(map.raw['battleback2Name']).trim(),
            map.where,
          )
        : null;
    if (map.raw['specifyBattleback'] !== true) unspecifiedBattlebacks++;
    map.data = {
      ...map.data,
      events: mapEvents,
      ...(music ? { music } : {}),
      ...(backgroundSound ? { backgroundSound } : {}),
      ...(battleBackground ? { battleBackground } : {}),
    };
  }
  const commonEvents = await convertCommonEvents(commonRaw, commonIds, events);
  const troops = await convertTroopEvents(db.troops, imported.troops, events);
  const sounds = await systemAudio(await readMzJson(source, 'data/System.json'), audio);
  // The project's battle background: the one MZ's editor uses to test battles.
  const systemRaw = asRecord(await readMzJson(source, 'data/System.json'));
  const battleBackground = await graphics.battleback(
    asString(systemRaw['battleback1Name']).trim(),
    asString(systemRaw['battleback2Name']).trim(),
    'System',
  );
  if (unspecifiedBattlebacks > 0) {
    report.changed(
      'Maps',
      `${unspecifiedBattlebacks} ${unspecifiedBattlebacks === 1 ? 'map lets' : 'maps let'} MZ choose the battle background from the ground; ${unspecifiedBattlebacks === 1 ? 'it uses' : 'they use'} the project's (Database › System), ${battleBackground ? 'the one MZ tests battles with' : 'none yet'}.`,
      [{ name: 'Battle backgrounds chosen from the ground', count: unspecifiedBattlebacks }],
    );
  }
  const titleImage = await graphics.title(
    mz.system.titleScreen.background,
    mz.system.titleScreen.frame,
  );
  const pictures = await graphics.finish();
  const animationEntries = await animations.finish(audio, report);

  const written = new Map<string, unknown>([
    [databasePaths.actors, entriesFile(imported.actors)],
    [databasePaths.classes, entriesFile(imported.classes)],
    [databasePaths.skills, entriesFile(imported.skills)],
    [databasePaths.items, entriesFile(imported.items)],
    [databasePaths.equipment, entriesFile(imported.equipment)],
    [databasePaths.states, entriesFile(imported.states)],
    [databasePaths.enemies, entriesFile(imported.enemies)],
    [databasePaths.troops, entriesFile(troops)],
    [databasePaths.commonEvents, entriesFile(commonEvents)],
    [databasePaths.animations, entriesFile(animationEntries)],
    [
      databasePaths.system,
      systemData(types, imported, {
        ...(Object.keys(sounds).length > 0 ? { audio: sounds } : {}),
        ...(pictures.iconset
          ? { iconset: pictures.iconset }
          : templateSystem.iconset
            ? { iconset: templateSystem.iconset }
            : {}),
        ...(pictures.balloons ? { balloons: pictures.balloons } : {}),
        ...(titleImage
          ? { titleScreen: { image: titleImage, showName: mz.system.titleScreen.showName } }
          : {}),
        ...(battleBackground ? { battleBackground } : {}),
      }),
    ],
  ]);
  const replaced = (f: string) =>
    maps.maps.length > 0 &&
    (manifest.maps.some((m) => m.path === f) ||
      manifest.tilesets.some((t) => t.path === f) ||
      f.startsWith('assets/tilesets/'));
  for (const map of maps.maps) written.set(map.path, map.data);
  for (const tileset of maps.tilesets) written.set(tileset.path, tileset.data);
  for (const character of pictures.characters) written.set(character.path, character.data);
  // The template's characters stay only if something still uses its hero.
  const templateCharacter = (f: string) =>
    !placeholderUsed &&
    (manifest.characters.some((c) => c.path === f) || f.startsWith('assets/characters/'));
  // The game's own music and sounds replace the template's.
  const templateAudio = (f: string) => f.startsWith('assets/audio/');
  // The template's icons go when the project has its own.
  const templateIcons = (f: string) =>
    pictures.iconset !== null && f === templateSystem.iconset?.image;
  // The template's animations and balloons belong to its own database: never copied.
  const templateAnimations = (f: string) =>
    f.startsWith('assets/animations/') || f === templateSystem.balloons?.image;
  if (maps.maps.length === 0) {
    // The template's maps stay, without their events (which use the template's database).
    for (const ref of manifest.maps)
      written.set(ref.path, { ...(await readTemplate(ref.path)), events: [] });
    report.missing(
      'Maps',
      'The project has no maps that could be imported; the Starter’s map is there instead.',
    );
  }

  const files = options.template.files.filter(
    (f) =>
      f !== TEMPLATE_INFO_FILE &&
      f !== MANIFEST_PATH &&
      !written.has(f) &&
      !replaced(f) &&
      !templateCharacter(f) &&
      !templateIcons(f) &&
      !templateAnimations(f) &&
      // The template's battle background belongs to its own system.json: never copied.
      !f.startsWith('assets/battlebacks/') &&
      !templateAudio(f),
  );
  const images = [...maps.images, ...pictures.files, ...audio.files];
  const total = files.length + written.size + images.length + 2;
  let done = 0;
  for (const path of files) {
    await target.writeBytes(path, await options.template.read(path));
    options.onProgress?.(++done, total);
  }
  for (const [path, data] of written) {
    await target.writeText(path, stableStringify(data));
    options.onProgress?.(++done, total);
  }
  for (const image of images) {
    await target.writeBytes(image.path, image.bytes);
    options.onProgress?.(++done, total);
  }
  await target.writeText(IMPORT_REPORT_FILE, report.toMarkdown(`Importing “${name}”`));

  await target.writeText(
    MANIFEST_PATH,
    stableStringify({
      ...manifest,
      name,
      id,
      screen: mz.system.screen,
      database: databasePaths,
      player: {
        ...manifest.player,
        character: playerCharacter,
        ...(mz.system.startHidden ? { hidden: true } : {}),
      },
      characters: [
        ...(placeholderUsed ? manifest.characters : []),
        ...pictures.characters.map((c) => ({ id: c.data.id, path: c.path })),
      ],
      start: { ...(maps.start ?? manifest.start), party, gold: 0 },
      ...(maps.maps.length > 0
        ? {
            maps: maps.maps.map((m) => ({ id: m.data.id, path: m.path })),
            tilesets: maps.tilesets.map((t) => ({ id: t.data.id, path: t.path })),
          }
        : {}),
      switches: [...switches.declarations('Switch'), ...extraSwitches],
      variables: variables.declarations('Variable'),
    }),
  );
  options.onProgress?.(total, total);
  return { name, id, report };
}

/** Where database files go when the template doesn't say. */
const DEFAULT_DATABASE_PATHS: Record<DatabaseKind, string> = Object.fromEntries(
  DATABASE_KINDS.map((kind) => [kind, `data/database/${kind}.json`]),
) as Record<DatabaseKind, string>;

/** Whether common event `n` is there (named, or with commands). */
function hasCommonEvent(raw: unknown, n: number): boolean {
  const entry = asArray(raw)[n];
  return (
    n > 0 &&
    isRecord(entry) &&
    (asString(entry['name']).trim() !== '' || asArray(entry['list']).length > 1)
  );
}
