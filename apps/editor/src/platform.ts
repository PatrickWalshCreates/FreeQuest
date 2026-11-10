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
