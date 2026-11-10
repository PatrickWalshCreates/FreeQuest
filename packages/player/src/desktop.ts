// The player inside the desktop app (apps/player-desktop): the game comes
// from the app's own Resources/game folder, saves are files in the app's
// data folder (one folder per game id), and the window takes the game's
// name and size. Loaded only inside the app, so web exports never fetch it.
import { type ProjectSource, startGame } from '@freequest/runtime';
import { convertFileSrc } from '@tauri-apps/api/core';
import { appDataDir, join, resourceDir } from '@tauri-apps/api/path';
import { LogicalSize, getCurrentWindow } from '@tauri-apps/api/window';
import { exists, mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import { type FileApi, FileSaveStorage } from './file-saves.js';

/** The game folder inside the app bundle, as a ProjectSource (asset protocol URLs). */
async function bundledGame(): Promise<ProjectSource> {
  const gameDir = await join(await resourceDir(), 'game');
  const url = (path: string) => convertFileSrc(`${gameDir}/${path}`);
  return {
    async readJson(path) {
      const response = await fetch(url(path));
      if (!response.ok) throw new Error(`Failed to load ${path}: HTTP ${response.status}`);
      return (await response.json()) as unknown;
    },
    assetUrl: async (path) => url(path),
  };
}

async function saveFiles(gameId: string): Promise<FileApi> {
  const dir = await join(await appDataDir(), 'saves', gameId);
  const path = (name: string) => join(dir, name);
  return {
    async list() {
      if (!(await exists(dir))) return [];
      return (await readDir(dir)).filter((e) => e.isFile).map((e) => e.name);
    },
    read: async (name) => readTextFile(await path(name)),
    async write(name, text) {
      await mkdir(dir, { recursive: true });
      await writeTextFile(await path(name), text);
    },
    async remove(name) {
      const file = await path(name);
      if (await exists(file)) await remove(file);
    },
  };
}

/** Start the game in the desktop app. Throws like startGame when it can't. */
export async function startDesktop(parent: HTMLElement): Promise<void> {
  const source = await bundledGame();
  const manifest = (await source.readJson('project.json')) as {
    id?: unknown;
    name?: unknown;
    screen?: { width?: unknown; height?: unknown };
  };
  const window = getCurrentWindow();
  if (typeof manifest.name === 'string') {
    document.title = manifest.name;
    await window.setTitle(manifest.name);
  }
  const { width, height } = manifest.screen ?? {};
  if (typeof width === 'number' && typeof height === 'number') {
    // Twice the game's resolution, unless that's bigger than the screen.
    const scale = Math.min(2, Math.floor((screen.availHeight - 40) / height) || 1);
    await window.setSize(new LogicalSize(width * scale, height * scale));
    await window.center();
  }
  const id = typeof manifest.id === 'string' ? manifest.id : 'game';
  const saves = await FileSaveStorage.open(await saveFiles(id));
  await startGame({ parent, project: source, saveStorage: saves });
}

/** Fullscreen for the desktop window (the browser Fullscreen API isn't the window's). */
export async function toggleDesktopFullscreen(): Promise<void> {
  const window = getCurrentWindow();
  await window.setFullscreen(!(await window.isFullscreen()));
}
