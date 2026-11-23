// Turning a project into the files a finished game needs: every data file,
// and exactly the images and sounds the data refers to, checked first so an
// export never ships a game that fails to start.
import {
  type Command,
  type MoveStep,
  type PluginParam,
  type PluginValues,
  SOUND_KEYS,
  pluginFolder,
  walkCommands,
} from '@freequest/schema';
import { MANIFEST_PATH, type OpenedProject, type Problem, allFiles } from './open-project.js';
import type { ProjectFs } from './project-fs.js';
import { utf8Length } from './utf8.js';

export type AssetKind = 'image' | 'audio' | 'font';

/** Sound files (a plugin's asset parameter says only "a file": its extension says which kind). */
const AUDIO_EXTENSION = /\.(wav|ogg|mp3|m4a|flac)$/i;

export interface AssetUse {
  readonly kind: AssetKind;
  /** Where it's used, e.g. "map Meadow: music" (for messages). */
  readonly usedBy: readonly string[];
}

/**
 * Every asset path the project's data refers to: tileset and character
 * images, enemy images, the iconset, map music, system music and sounds,
 * and playMusic / playSound / background sound / battle music commands in
 * events and common events.
 */
export function assetReferences(project: OpenedProject): Map<string, AssetUse> {
  const found = new Map<string, { kind: AssetKind; usedBy: string[] }>();
  const add = (path: string | null | undefined, kind: AssetKind, where: string) => {
    if (!path) return;
    const entry = found.get(path) ?? { kind, usedBy: [] };
    entry.usedBy.push(where);
    found.set(path, entry);
  };

  // Files named by plugin values: by the parameter's declared type, an image
  // or a sound from its extension.
  const addPluginValues = (
    params: readonly PluginParam[] | undefined,
    values: PluginValues | undefined,
    at: string,
  ) => {
    for (const param of params ?? []) {
      const value = values?.[param.name];
      if (param.type === 'asset' && typeof value === 'string' && value.startsWith('assets/')) {
        add(value, AUDIO_EXTENSION.test(value) ? 'audio' : 'image', at);
      }
    }
  };
  // Sounds played by move route steps (v9).
  const addStepSounds = (steps: readonly MoveStep[], at: string) => {
    for (const step of steps) if (step.type === 'sound') add(step.path, 'audio', at);
  };
  // Every file a command list's commands play or show.
  const addCommands = (commands: readonly Command[], at: string) =>
    walkCommands(commands, (command) => {
      switch (command.type) {
        case 'playMusic':
        case 'playBackgroundSound':
        case 'changeBattleMusic':
          add(command.path, 'audio', at);
          break;
        case 'playSound':
          add(command.path, 'audio', at);
          break;
        case 'message':
          add(command.face?.image, 'image', at);
          break;
        case 'showPicture':
          add(command.image, 'image', at);
          break;
        case 'battle':
          add(command.background, 'image', at);
          break;
        case 'changeBattleBackground':
          add(command.image ?? undefined, 'image', at);
          break;
        case 'moveRoute':
          addStepSounds(command.steps, at);
          break;
        case 'plugin':
          addPluginValues(
            project.plugins
              .get(command.plugin)
              ?.data?.commands.find((c) => c.id === command.command)?.params,
            command.args,
            at,
          );
          break;
      }
    });
  for (const ref of project.manifest.data.plugins ?? []) {
    const declaration = project.plugins.get(ref.id)?.data;
    addPluginValues(declaration?.settings, ref.settings, `plugin ${declaration?.name ?? ref.id}`);
  }
  for (const [id, file] of project.tilesets) add(file.data?.image, 'image', `tileset ${id}`);
  for (const [id, file] of project.characters) add(file.data?.image, 'image', `character ${id}`);
  for (const [id, file] of project.maps) {
    const map = file.data;
    if (!map) continue;
    const where = `map ${map.name || id}`;
    add(map.music, 'audio', `${where}: music`);
    add(map.backgroundSound, 'audio', `${where}: background sound`);
    add(map.battleBackground, 'image', `${where}: battle background`);
    for (const event of map.events) {
      event.pages.forEach((page, i) =>
        addCommands(page.commands, `${where}, event ${event.name} (page ${i + 1})`),
      );
      event.pages.forEach((page, i) => {
        if (page.movement?.type === 'route') {
          addStepSounds(page.movement.steps, `${where}, event ${event.name} (page ${i + 1}) route`);
        }
      });
    }
  }

  const system = project.database.system?.data;
  if (system) {
    const audio = system.audio;
    for (const key of ['titleMusic', 'battleMusic', 'victoryMusic', 'gameOverMusic'] as const) {
      add(audio?.[key], 'audio', `system ${key}`);
    }
    for (const key of SOUND_KEYS) add(audio?.sounds?.[key], 'audio', `system sound ${key}`);
    add(system.iconset?.image, 'image', 'system iconset');
    add(system.balloons?.image, 'image', 'system balloons');
    add(system.titleScreen?.image, 'image', 'system title screen');
    add(system.battleBackground, 'image', 'system battle background');
    add(system.ui?.font, 'font', 'system window font');
  }
  for (const animation of project.database.animations?.data?.entries ?? []) {
    add(animation.image, 'image', `animation ${animation.name}`);
    for (const sound of animation.sounds) add(sound.path, 'audio', `animation ${animation.name}`);
  }
  for (const enemy of project.database.enemies?.data?.entries ?? []) {
    add(enemy.image, 'image', `enemy ${enemy.name}`);
  }
  for (const common of project.database.commonEvents?.data?.entries ?? []) {
    addCommands(common.commands, `common event ${common.name}`);
  }
  for (const troop of project.database.troops?.data?.entries ?? []) {
    troop.events?.forEach((page, i) =>
      addCommands(page.commands, `troop ${troop.name} (battle event ${i + 1})`),
    );
  }
  return new Map([...found].sort(([a], [b]) => a.localeCompare(b)));
}

/** One file of an export, at its project-relative path. */
export type ExportFile =
  /** A data file, written from the (possibly unsaved) document. */
  | { readonly kind: 'data'; readonly path: string; readonly data: unknown }
  /** An asset, copied byte for byte from the project folder. */
  | { readonly kind: 'asset'; readonly path: string };

export interface ExportPlan {
  readonly files: readonly ExportFile[];
  /** Problems that would stop the game from starting: nothing is exported while there are any. */
  readonly errors: readonly Problem[];
  /** Worth knowing but not fatal (the game plays without them), e.g. a missing sound. */
  readonly warnings: readonly Problem[];
}

/** The top folder of each path ("assets/audio/a.wav" → "assets"), for listing what exists. */
function topFolders(paths: Iterable<string>): string[] {
  const folders = new Set<string>();
  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash > 0) folders.add(path.slice(0, slash));
  }
  return [...folders].sort();
}

/**
 * Work out what an export contains and whether it can go ahead. Every
 * project problem blocks it, because the game checks the same things when
 * it starts and would refuse to run. Missing images block too (the game
 * can't draw without them); missing audio is a warning (the game plays on
 * in silence).
 */
export async function planExport(project: OpenedProject, fs: ProjectFs): Promise<ExportPlan> {
  const errors: Problem[] = [...project.problems];
  const warnings: Problem[] = [];
  const files: ExportFile[] = [];

  for (const file of allFiles(project)) {
    if (file.data === null) {
      if (!errors.some((p) => p.source === file.path)) {
        errors.push({ source: file.path, message: 'could not be loaded' });
      }
      continue;
    }
    files.push({ kind: 'data', path: file.path, data: file.data });
  }

  // Enabled plugins ship their whole folder (script, its images…); a turned-off
  // one ships only its declaration, which the manifest still lists.
  for (const ref of project.manifest.data.plugins ?? []) {
    const declaration = project.plugins.get(ref.id);
    if (!ref.enabled || !declaration) continue;
    const folder = pluginFolder(declaration.path);
    for (const path of await fs.list(folder.slice(0, -1))) {
      if (path !== declaration.path) files.push({ kind: 'asset', path });
    }
  }

  const assets = assetReferences(project);
  const existing = new Set<string>();
  for (const folder of topFolders(assets.keys())) {
    for (const path of await fs.list(folder)) existing.add(path);
  }
  for (const [path, use] of assets) {
    if (existing.has(path)) {
      files.push({ kind: 'asset', path });
      continue;
    }
    const problem = {
      source: path,
      message: `${use.kind === 'audio' ? 'sound' : use.kind} not found (used by ${use.usedBy.join('; ')})`,
    };
    // Without an image the game refuses to start; without a sound or font it goes on (silent, or
    // in the system font).
    (use.kind === 'image' ? errors : warnings).push(problem);
  }
  return { files, errors, warnings };
}

export interface ExportProgress {
  readonly done: number;
  readonly total: number;
  readonly path: string;
}

export interface ExportResult {
  readonly files: number;
  readonly bytes: number;
}

export interface WriteExportOptions {
  /** Folder inside the target the game files go into, e.g. "game" (default: the target's root). */
  readonly prefix?: string;
  readonly onProgress?: (progress: ExportProgress) => void;
}

/**
 * Write a plan's files from `source` (the project folder) into `target`.
 * Data files are written as compact JSON (players don't read diffs);
 * project.json goes last so a half-written export never looks complete.
 */
export async function writeExport(
  plan: ExportPlan,
  source: ProjectFs,
  target: ProjectFs,
  options: WriteExportOptions = {},
): Promise<ExportResult> {
  if (plan.errors.length > 0) {
    throw new Error(`Can't export while there are problems (${plan.errors.length})`);
  }
  const prefix = options.prefix ? `${options.prefix.replace(/\/+$/, '')}/` : '';
  const ordered = [...plan.files].sort(
    (a, b) => Number(a.path === MANIFEST_PATH) - Number(b.path === MANIFEST_PATH),
  );
  let bytes = 0;
  for (const [i, file] of ordered.entries()) {
    const to = `${prefix}${file.path}`;
    if (file.kind === 'data') {
      const text = JSON.stringify(file.data);
      bytes += utf8Length(text);
      await target.writeText(to, text);
    } else {
      const data = await source.readBytes(file.path);
      bytes += data.length;
      await target.writeBytes(to, data);
    }
    options.onProgress?.({ done: i + 1, total: ordered.length, path: file.path });
  }
  return { files: ordered.length, bytes };
}
