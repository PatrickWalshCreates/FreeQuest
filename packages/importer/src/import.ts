// Importing an MZ project: read it, then write a new FreeQuest project into an
// empty folder. The MZ folder is only ever read. Whatever the importer doesn't
// make itself (yet) comes from a template (the Starter), so the result always
// opens and plays. project.json is written last, so an interrupted import
// never looks like a finished project.
import {
  MANIFEST_PATH,
  type ProjectFs,
  TEMPLATE_INFO_FILE,
  type TemplateSource,
  decodeUtf8,
  newProjectProblem,
  suggestGameId,
} from '@freequest/editor-core';
import {
  DATABASE_KINDS,
  type DatabaseKind,
  type Manifest,
  type SystemData,
  stableStringify,
} from '@freequest/schema';
import { entriesFile, importDatabase, systemData } from './database.js';
import { readMzDatabase } from './mz-lists.js';
import { SystemTypes } from './system-types.js';
import { NumberedIds } from './ids.js';
import { readMzProject } from './mz-project.js';
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
  const imported = importDatabase({
    db,
    types,
    variables,
    report,
    placeholderCharacter: manifest.player.character,
  });
  const databasePaths = { ...DEFAULT_DATABASE_PATHS, ...manifest.database };
  const templateSystem = (await readTemplate(databasePaths.system)) as unknown as SystemData;
  const written = new Map<string, unknown>([
    [databasePaths.actors, entriesFile(imported.actors)],
    [databasePaths.classes, entriesFile(imported.classes)],
    [databasePaths.skills, entriesFile(imported.skills)],
    [databasePaths.items, entriesFile(imported.items)],
    [databasePaths.equipment, entriesFile(imported.equipment)],
    [databasePaths.states, entriesFile(imported.states)],
    [databasePaths.enemies, entriesFile(imported.enemies)],
    [databasePaths.troops, entriesFile(imported.troops)],
    [databasePaths.commonEvents, entriesFile([])],
    [databasePaths.system, systemData(types, imported, templateSystem)],
  ]);
  // Until maps are imported, the template's maps stay, without their events
  // (which use the template's database).
  for (const ref of manifest.maps) {
    const map = await readTemplate(ref.path);
    written.set(ref.path, { ...map, events: [] });
  }

  report.missing(
    'Maps and events',
    'Not imported yet: this version of the importer brings the project settings, switches, variables and the database. The maps are the Starter template’s.',
  );

  const files = options.template.files.filter(
    (f) => f !== TEMPLATE_INFO_FILE && f !== MANIFEST_PATH && !written.has(f),
  );
  const total = files.length + written.size + 2;
  let done = 0;
  for (const path of files) {
    await target.writeBytes(path, await options.template.read(path));
    options.onProgress?.(++done, total);
  }
  for (const [path, data] of written) {
    await target.writeText(path, stableStringify(data));
    options.onProgress?.(++done, total);
  }
  await target.writeText(IMPORT_REPORT_FILE, report.toMarkdown(`Importing “${name}”`));

  const party = mz.system.party.flatMap((n) => db.actors.id(n) ?? []);
  const firstActor = imported.actors[0];
  if (party.length === 0 && firstActor) party.push(firstActor.id);
  await target.writeText(
    MANIFEST_PATH,
    stableStringify({
      ...manifest,
      name,
      id,
      screen: mz.system.screen,
      database: databasePaths,
      start: { ...manifest.start, party, gold: 0 },
      switches: switches.declarations('Switch'),
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
