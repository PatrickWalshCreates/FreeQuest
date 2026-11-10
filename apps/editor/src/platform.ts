import { type ProjectFs } from '@freequest/editor-core';
import { isTauri } from '@tauri-apps/api/core';

/** True in the desktop app; false in a browser tab during development. */
export const IN_DESKTOP_APP = isTauri();

/** Open a project folder chosen by the user (desktop) or a sample project (browser dev). */
export async function desktopFs(): Promise<ProjectFs | null> {
  const { TauriFs, pickProjectFolder } = await import('./fs/tauri-fs.js');
  const folder = await pickProjectFolder();
  return folder ? new TauriFs(folder) : null;
}

export async function devFs(project: string): Promise<ProjectFs> {
  const { DevServerFs } = await import('./fs/dev-fs.js');
  return new DevServerFs(project);
}

/** Ask the user to confirm something destructive. Resolves true when they agree. */
export async function confirmAction(
  message: string,
  options: { readonly title: string; readonly okLabel: string },
): Promise<boolean> {
  if (!IN_DESKTOP_APP) return window.confirm(message);
  const { ask } = await import('@tauri-apps/plugin-dialog');
  return ask(message, {
    title: options.title,
    kind: 'warning',
    okLabel: options.okLabel,
    cancelLabel: 'Cancel',
  });
}

/** Ask before throwing away unsaved changes. */
export function confirmDiscard(message: string): Promise<boolean> {
  return confirmAction(message, { title: 'Unsaved changes', okLabel: 'Discard changes' });
}

/** Warn before the window (or browser tab) closes while `isDirty()`. Returns an unregister function. */
export function guardWindowClose(isDirty: () => boolean): () => void {
  if (!IN_DESKTOP_APP) {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (isDirty()) event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }
  let unlisten: (() => void) | null = null;
  let disposed = false;
  void import('@tauri-apps/api/window')
    .then(({ getCurrentWindow }) =>
      getCurrentWindow().onCloseRequested(async (event) => {
        if (
          isDirty() &&
          !(await confirmDiscard('Close the editor and lose your unsaved changes?'))
        ) {
          event.preventDefault();
        }
      }),
    )
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Where an export goes: a folder the user picks (desktop) or a named folder under exports/ (browser). */
export interface ExportFolder {
  readonly fs: ProjectFs;
  /** Shown to the user. */
  readonly label: string;
  /** In browser mode, where the dev server serves the export, so it can be played at once. */
  readonly playUrl: string | null;
}

/** Ask for an export folder on the desktop. Null when the user cancels. */
export async function pickExportFolder(): Promise<ExportFolder | null> {
  const { TauriFs } = await import('./fs/tauri-fs.js');
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({ directory: true, recursive: true, title: 'Choose an export folder' });
  if (typeof picked !== 'string') return null;
  return { fs: new TauriFs(picked), label: picked, playUrl: null };
}

/** A folder under exports/ in browser mode. */
export async function devExportFolder(name: string): Promise<ExportFolder> {
  const { DevServerFs } = await import('./fs/dev-fs.js');
  return {
    fs: new DevServerFs(name, 'exports'),
    label: `exports/${name}`,
    playUrl: `/__freequest/exports/fs/${encodeURIComponent(name)}/index.html`,
  };
}

/** The release player bundled with the editor (served at /player-release/). */
export async function bundledPlayer(): Promise<{
  files: string[];
  read(path: string): Promise<Uint8Array>;
}> {
  const base = new URL('player-release/', window.location.href);
  const response = await fetch(new URL('files.json', base));
  if (!response.ok) {
    throw new Error(
      'The release player is missing from the editor. Build it with "pnpm --filter @freequest/player build".',
    );
  }
  const { files } = (await response.json()) as { files: string[] };
  return {
    files,
    read: async (path) => {
      const file = await fetch(new URL(path, base));
      if (!file.ok) throw new Error(`Player file ${path}: HTTP ${file.status}`);
      return new Uint8Array(await file.arrayBuffer());
    },
  };
}
