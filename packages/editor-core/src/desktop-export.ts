// Windows and Linux exports: a folder with the desktop player program (the
// prebuilt "shell", renamed after the game), the game in a game/ folder next
// to it, and the licence notices. Tauri finds a plain program's resources in
// its own folder on both systems, so the player loads game/ from beside it.
// The player shells are built on Windows and Linux (by CI); exporting only
// copies files, so any computer can make these exports.
import { type ExportPlan, type ExportProgress, type ExportResult, writeExport } from './export.js';
import { macAppName } from './mac-export.js';
import type { OpenedProject } from './open-project.js';
import type { ProjectFs } from './project-fs.js';
import { EXPORT_MARKER, GAME_FOLDER, inspectTarget } from './web-export.js';

export type DesktopTarget = 'windows' | 'linux';

/** The program in each player shell folder, as CI builds it. */
export const DESKTOP_SHELL_PROGRAM: Readonly<Record<DesktopTarget, string>> = {
  windows: 'freequest-player.exe',
  linux: 'freequest-player',
};

/** What players call each system. */
export const DESKTOP_TARGET_NAMES: Readonly<Record<DesktopTarget, string>> = {
  windows: 'Windows',
  linux: 'Linux',
};

/** The licence notices file in a shell folder (copied into every export). */
export const NOTICES_FILE = 'THIRD_PARTY_NOTICES.txt';

/** The export's folder name: the game's name without characters file systems dislike. */
export function desktopFolderName(gameName: string, fallback: string): string {
  return macAppName(gameName, fallback).replace(/\.app$/, '');
}

/**
 * The program's name in the export: "<Game name>.exe" on Windows; on Linux
 * the game's id (lowercase, no spaces), as Linux programs are usually named.
 */
export function desktopProgramName(
  target: DesktopTarget,
  gameName: string,
  gameId: string,
): string {
  return target === 'windows' ? `${desktopFolderName(gameName, gameId)}.exe` : gameId;
}

/** Why a shell folder can't be used for exporting, or null if it has what an export needs. */
export async function desktopShellProblem(
  target: DesktopTarget,
  shell: ProjectFs,
): Promise<string | null> {
  const files = await shell.list('');
  if (!files.includes(DESKTOP_SHELL_PROGRAM[target])) {
    return `The ${DESKTOP_TARGET_NAMES[target]} player (${DESKTOP_SHELL_PROGRAM[target]}) isn't there`;
  }
  return null;
}

export interface DesktopExportOptions {
  readonly target: DesktopTarget;
  readonly project: OpenedProject;
  readonly plan: ExportPlan;
  /** The project folder (assets are copied from it). */
  readonly source: ProjectFs;
  /** The player shell folder for this system (the program and its notices). */
  readonly shell: ProjectFs;
  /** The output folder: must be empty. */
  readonly output: ProjectFs;
  readonly freequestVersion: string;
  readonly now?: Date;
  readonly onProgress?: (progress: ExportProgress) => void;
}

export interface DesktopExportResult extends ExportResult {
  /** The game's folder inside the output folder, e.g. "FreeQuest Demo". */
  readonly folder: string;
  /** The program inside it, e.g. "FreeQuest Demo.exe". */
  readonly program: string;
}

/** Write "<Game>/" (program, game/, notices) into an empty folder. */
export async function exportDesktop(options: DesktopExportOptions): Promise<DesktopExportResult> {
  const { target, project, plan, source, shell, output } = options;
  if ((await inspectTarget(output)).kind !== 'empty') {
    throw new Error('The export folder must be empty');
  }
  const problem = await desktopShellProblem(target, shell);
  if (problem) throw new Error(problem);
  const manifest = project.manifest.data;
  const folder = desktopFolderName(manifest.name, manifest.id);
  const program = desktopProgramName(target, manifest.name, manifest.id);
  const shellFiles = await shell.list('');
  const extras = shellFiles.includes(NOTICES_FILE) ? [NOTICES_FILE] : [];
  const total = 1 + extras.length + plan.files.length;
  let done = 0;
  let bytes = 0;

  const binary = await shell.readBytes(DESKTOP_SHELL_PROGRAM[target]);
  await output.writeBytes(`${folder}/${program}`, binary, { executable: target === 'linux' });
  bytes += binary.length;
  options.onProgress?.({ done: ++done, total, path: program });
  for (const file of extras) {
    const data = await shell.readBytes(file);
    await output.writeBytes(`${folder}/${file}`, data);
    bytes += data.length;
    options.onProgress?.({ done: ++done, total, path: file });
  }
  const written = await writeExport(plan, source, output, {
    prefix: `${folder}/${GAME_FOLDER}`,
    onProgress: (p) => options.onProgress?.({ done: done + p.done, total, path: p.path }),
  });
  await output.writeText(
    EXPORT_MARKER,
    `${JSON.stringify(
      {
        formatVersion: 1,
        target,
        game: manifest.id,
        name: manifest.name,
        folder,
        program,
        exportedAt: (options.now ?? new Date()).toISOString(),
        freequest: options.freequestVersion,
      },
      null,
      2,
    )}\n`,
  );
  return { folder, program, files: written.files, bytes: bytes + written.bytes };
}
