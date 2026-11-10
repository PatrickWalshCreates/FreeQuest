// What the game reads when playtesting from the editor: the document as it
// is right now (unsaved edits included), not the files on disk.
import type { ProjectDocument } from './document.js';
import { allFiles } from './open-project.js';

/** Structurally the runtime's `ProjectSource` (editor-core doesn't depend on the runtime). */
export interface PlaytestSource {
  readJson(path: string): Promise<unknown>;
  assetUrl(path: string): Promise<string>;
}

/**
 * Snapshot the document for a playtest. Later edits don't leak into a
 * running game. Files the editor couldn't load are read from disk, so the
 * game reports the same error it would in a real run.
 */
export function playtestSource(doc: ProjectDocument): PlaytestSource {
  const snapshot = new Map(
    allFiles(doc.project).flatMap((file) => (file.data ? [[file.path, file.data] as const] : [])),
  );
  return {
    async readJson(path) {
      const data = snapshot.get(path);
      // A copy, so nothing the game does can touch the editor's data. (Project data is
      // plain JSON; structuredClone isn't available without DOM/Node typings.)
      if (data !== undefined) return JSON.parse(JSON.stringify(data)) as unknown;
      const text = await doc.fs.readText(path);
      try {
        return JSON.parse(text) as unknown;
      } catch (error) {
        throw new Error(`${path}: invalid JSON: ${(error as Error).message}`, { cause: error });
      }
    },
    assetUrl: (path) => doc.fs.assetUrl(path),
  };
}
