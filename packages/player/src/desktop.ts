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

/**
 * Make the space the page gets twice the game's resolution (or as many
 * whole steps as fit the screen): the game scales in whole steps to stay
 * crisp, so a space a few points too small would drop it to 1×. The window's
 * own idea of its inside includes the title bar on macOS, so the page's
 * viewport is measured after resizing and the window grown by the shortfall.
 */
async function fitWindow(width: number, height: number): Promise<void> {
  const window = getCurrentWindow();
  const room = Math.floor((screen.availHeight - 80) / height);
  const scale = Math.max(1, Math.min(2, room));
  const want = { width: width * scale, height: height * scale };
  await window.setSize(new LogicalSize(want.width, want.height));
  await viewportSettled();
  const short = { width: want.width - innerWidth, height: want.height - innerHeight };
  if (short.width > 0 || short.height > 0) {
    await window.setSize(
      new LogicalSize(
        want.width + Math.max(0, short.width),
        want.height + Math.max(0, short.height),
      ),
    );
    await viewportSettled();
  }
  await window.center();
}

/** Wait for the page to see the window's new size (a resize event, or a moment). */
function viewportSettled(): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      globalThis.removeEventListener('resize', done);
      setTimeout(resolve, 50);
    };
    const timer = setTimeout(done, 400);
    globalThis.addEventListener('resize', done);
  });
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
    await fitWindow(width, height);
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
