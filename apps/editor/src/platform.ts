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
