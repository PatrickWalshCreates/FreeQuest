// A whole web export: the game's files under game/, the release player
// beside them, and a marker that identifies the folder as an export. Shared
// by the editor's Export dialog and the freequest CLI.
import { type ExportPlan, type ExportProgress, type ExportResult, writeExport } from './export.js';
import type { OpenedProject } from './open-project.js';
import type { ProjectFs } from './project-fs.js';

/** Marks a folder as a FreeQuest export, so replacing one never deletes anything else. */
export const EXPORT_MARKER = 'freequest-export.json';

/** Where an exported game's own files go, next to the player. */
export const GAME_FOLDER = 'game';

/** The built release player: its files, and a way to read each one. */
export interface PlayerFiles {
  readonly files: readonly string[];
  read(path: string): Promise<Uint8Array>;
}

/** What's in an output folder already. */
export type TargetState =
  | { readonly kind: 'empty' }
  /** A previous FreeQuest export: safe to replace. */
  | { readonly kind: 'export'; readonly game: string | null; readonly files: number }
  /** Something else: never written into. */
  | { readonly kind: 'other'; readonly files: number };

export async function inspectTarget(target: ProjectFs): Promise<TargetState> {
  const files = await target.list('');
  if (files.length === 0) return { kind: 'empty' };
  if (!files.includes(EXPORT_MARKER)) return { kind: 'other', files: files.length };
  let game: string | null = null;
  try {
    const marker = JSON.parse(await target.readText(EXPORT_MARKER)) as { game?: unknown };
    if (typeof marker.game === 'string') game = marker.game;
  } catch {
    // A damaged marker still marks an export.
  }
  return { kind: 'export', game, files: files.length };
}

/** Delete a previous export's files. Refuses unless the folder is one (has the marker). */
export async function clearExport(target: ProjectFs): Promise<void> {
  const state = await inspectTarget(target);
  if (state.kind === 'other')
    throw new Error('Not a FreeQuest export: refusing to delete its files');
  for (const path of await target.list('')) await target.remove(path);
}

export interface WebExportOptions {
  readonly project: OpenedProject;
  readonly plan: ExportPlan;
  /** The project folder (assets are copied from it). */
  readonly source: ProjectFs;
  /** The output folder: must be empty (see `inspectTarget` / `clearExport`). */
  readonly target: ProjectFs;
  readonly player: PlayerFiles;
  /** Recorded in the marker. */
  readonly freequestVersion: string;
  readonly now?: Date;
  readonly onProgress?: (progress: ExportProgress) => void;
}

/** Write a complete web export into an empty folder. */
export async function exportWeb(options: WebExportOptions): Promise<ExportResult> {
  const { project, plan, source, target, player } = options;
  const state = await inspectTarget(target);
  if (state.kind !== 'empty') throw new Error('The export folder must be empty');
  const total = plan.files.length + player.files.length;
  const written = await writeExport(plan, source, target, {
    prefix: GAME_FOLDER,
    onProgress: (p) => options.onProgress?.({ ...p, total }),
  });
  let bytes = written.bytes;
  for (const [i, file] of player.files.entries()) {
    const data = await player.read(file);
    bytes += data.length;
    await target.writeBytes(file, data);
    options.onProgress?.({ done: written.files + i + 1, total, path: file });
  }
  const manifest = project.manifest.data;
  await target.writeText(
    EXPORT_MARKER,
    `${JSON.stringify(
      {
        formatVersion: 1,
        target: 'web',
        game: manifest.id,
        name: manifest.name,
        exportedAt: (options.now ?? new Date()).toISOString(),
        freequest: options.freequestVersion,
      },
      null,
      2,
    )}\n`,
  );
  return { files: written.files, bytes };
}
