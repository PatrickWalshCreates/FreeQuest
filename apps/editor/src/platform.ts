import type { ProjectFs, TemplateInfo, TemplateSource } from '@freequest/editor-core';
import { invoke, isTauri } from '@tauri-apps/api/core';

/** True in the desktop app; false in a browser tab during development. */
export const IN_DESKTOP_APP = isTauri();

/** Open a project folder chosen by the user (desktop) or a sample project (browser dev). */
export async function desktopFs(): Promise<ProjectFs | null> {
  const { TauriFs, pickProjectFolder } = await import('./fs/tauri-fs.js');
  const folder = await pickProjectFolder();
  return folder ? new TauriFs(folder) : null;
}

export async function devFs(
  project: string,
  area: 'samples' | 'projects' = 'samples',
): Promise<ProjectFs> {
  const { DevServerFs } = await import('./fs/dev-fs.js');
  return new DevServerFs(project, area);
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

/** Mac apps can be exported only from the desktop editor on a Mac (signing needs codesign). */
export const CAN_EXPORT_MAC = IN_DESKTOP_APP && /Mac/i.test(navigator.userAgent);

/** The desktop player app bundled with the editor, which Mac exports are made from. */
export async function macShell(): Promise<ProjectFs> {
  const { resourceDir, join } = await import('@tauri-apps/api/path');
  const { TauriFs } = await import('./fs/tauri-fs.js');
  return new TauriFs(await join(await resourceDir(), 'mac-player', 'FreeQuest Player.app'));
}

/** Ad-hoc sign an exported app (runs codesign through the editor's Rust side). */
export async function signMacApp(appPath: string): Promise<void> {
  await invoke('sign_mac_app', { path: appPath });
}

export interface BundledTemplate extends TemplateInfo {
  readonly files: readonly string[];
}

/** The project templates bundled with the editor (served at /project-templates/). */
export async function bundledTemplates(): Promise<BundledTemplate[]> {
  const response = await fetch(new URL('project-templates/index.json', window.location.href));
  if (!response.ok) throw new Error(`Project templates are missing (HTTP ${response.status})`);
  return (await response.json()) as BundledTemplate[];
}

export function templateSource(template: BundledTemplate): TemplateSource {
  const base = new URL(`project-templates/${template.id}/`, window.location.href);
  return {
    files: template.files,
    read: async (path) => {
      const response = await fetch(
        new URL(path.split('/').map(encodeURIComponent).join('/'), base),
      );
      if (!response.ok) throw new Error(`Template file ${path}: HTTP ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

/** A folder name for a project: the game's name without characters file systems dislike. */
export function projectFolderName(name: string): string {
  return (
    [...name.trim()]
      .map((c) => (c.charCodeAt(0) < 0x20 || '/\\:*?"<>|'.includes(c) ? '-' : c))
      .join('')
      .replace(/^\.+/, '') || 'My Game'
  );
}

/** Where a new project goes: a new folder inside one the user picks (desktop). */
export async function pickNewProjectParent(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open({
    directory: true,
    recursive: true,
    title: 'Choose where to put the new project',
  });
  return typeof picked === 'string' ? picked : null;
}

/** The new project's folder: `<parent>/<folder>` on the desktop, projects/<folder> in browser mode. */
export async function newProjectFs(parent: string | null, folder: string): Promise<ProjectFs> {
  if (IN_DESKTOP_APP) {
    if (!parent) throw new Error('Choose where to put the project');
    const { TauriFs } = await import('./fs/tauri-fs.js');
    return new TauriFs(`${parent.replace(/[\\/]+$/, '')}/${folder}`);
  }
  return devFs(folder, 'projects');
}

/** Where the project in `fs` can be reopened from (see `projectFsAt`). */
export function projectLocation(fs: ProjectFs): string {
  return fs.label;
}

/**
 * Reopen a project from its location: a folder path on the desktop (still
 * readable after a restart thanks to the persisted-scope plugin), or
 * "<area>/<name>" in browser mode.
 */
export async function projectFsAt(location: string): Promise<ProjectFs> {
  if (IN_DESKTOP_APP) {
    const { TauriFs } = await import('./fs/tauri-fs.js');
    return new TauriFs(location);
  }
  const [area, name, ...rest] = location.split('/');
  if ((area !== 'samples' && area !== 'projects') || !name || rest.length > 0) {
    throw new Error(`Not a browser-mode project: ${location}`);
  }
  return devFs(name, area);
}
