// Starting a new project from a template: a project folder whose files are
// copied into an empty folder, with the new game's name and id.
import { ID_PATTERN, idFromName, stableStringify } from '@freequest/schema';
import { MANIFEST_PATH } from './open-project.js';
import type { ProjectFs } from './project-fs.js';
import { decodeUtf8 } from './utf8.js';

/** A template's own description, beside its project files (never copied). */
export const TEMPLATE_INFO_FILE = 'template.json';

export interface TemplateInfo {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/** A template's files and a way to read them (bundled with the editor, or a folder on disk). */
export interface TemplateSource {
  readonly files: readonly string[];
  read(path: string): Promise<Uint8Array>;
}

export interface NewProjectOptions {
  readonly name: string;
  /** The game id (see `suggestGameId`). */
  readonly id: string;
}

/** A game id for a name: "My Big Quest!" → "my-big-quest". */
export function suggestGameId(name: string): string {
  return idFromName(name, 'my-game');
}

/** Why a new project can't be made with these options, or null when it can. */
export function newProjectProblem(options: NewProjectOptions): string | null {
  if (options.name.trim() === '') return 'Give the game a name';
  if (!new RegExp(ID_PATTERN).test(options.id)) {
    return 'The game id can only use lowercase letters, digits, "-" and "_"';
  }
  return null;
}

export interface CreateProjectOptions extends NewProjectOptions {
  readonly onProgress?: (done: number, total: number) => void;
}

/**
 * Copy a template into an empty folder as a new project named `name` with
 * game id `id`. project.json is written last, so a folder interrupted half
 * way never looks like a finished project.
 */
export async function createProject(
  template: TemplateSource,
  target: ProjectFs,
  options: CreateProjectOptions,
): Promise<void> {
  const problem = newProjectProblem(options);
  if (problem) throw new Error(problem);
  if ((await target.list('')).length > 0) {
    throw new Error('Choose an empty folder for the new project');
  }
  const files = template.files.filter((f) => f !== TEMPLATE_INFO_FILE);
  if (!files.includes(MANIFEST_PATH)) throw new Error('The template has no project.json');
  const others = files.filter((f) => f !== MANIFEST_PATH);
  for (const [i, path] of others.entries()) {
    await target.writeBytes(path, await template.read(path));
    options.onProgress?.(i + 1, files.length);
  }
  const manifest = JSON.parse(decodeUtf8(await template.read(MANIFEST_PATH))) as Record<
    string,
    unknown
  >;
  await target.writeText(
    MANIFEST_PATH,
    stableStringify({ ...manifest, name: options.name.trim(), id: options.id }),
  );
  options.onProgress?.(files.length, files.length);
}
