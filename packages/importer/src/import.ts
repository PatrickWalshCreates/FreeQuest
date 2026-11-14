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
import { stableStringify } from '@freequest/schema';
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

  // Switches and variables share one id space in FreeQuest.
  const gameStateIds = new Set<string>();
  const switches = new NumberedIds(mz.system.switches, 'switch', gameStateIds);
  const variables = new NumberedIds(mz.system.variables, 'variable', gameStateIds);

  report.missing(
    'Maps, database and events',
    'Not imported yet: this version of the importer brings the project settings, switches and variables. The rest of the project is the Starter template.',
  );

  if (!options.template.files.includes(MANIFEST_PATH))
    throw new Error('The template has no project.json');
  const files = options.template.files.filter(
    (f) => f !== TEMPLATE_INFO_FILE && f !== MANIFEST_PATH,
  );
  const total = files.length + 2;
  for (const [i, path] of files.entries()) {
    await target.writeBytes(path, await options.template.read(path));
    options.onProgress?.(i + 1, total);
  }
  await target.writeText(IMPORT_REPORT_FILE, report.toMarkdown(`Importing “${name}”`));

  const manifest = JSON.parse(decodeUtf8(await options.template.read(MANIFEST_PATH))) as Record<
    string,
    unknown
  >;
  await target.writeText(
    MANIFEST_PATH,
    stableStringify({
      ...manifest,
      name,
      id,
      screen: mz.system.screen,
      switches: switches.declarations('Switch'),
      variables: variables.declarations('Variable'),
    }),
  );
  options.onProgress?.(total, total);
  return { name, id, report };
}
