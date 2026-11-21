// The demo project's database, read from disk the way the loader would parse it.
import { DatabaseIndex } from '@freequest/core';
import {
  DATABASE_KINDS,
  type DatabaseFiles,
  assembleDatabase,
  parseProjectFile,
} from '@freequest/schema';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');
export const readDemo = (path: string): unknown =>
  JSON.parse(readFileSync(join(DEMO, path), 'utf8'));

/** The demo's database; `extraActors` adds copies of the hero with these ids (for big parties). */
export function demoDb(extraActors: readonly string[] = []): DatabaseIndex {
  const files = Object.fromEntries(
    DATABASE_KINDS.map((k) => [k, parseProjectFile(k, readDemo(`data/database/${k}.json`))]),
  ) as DatabaseFiles;
  const hero = files.actors?.entries[0];
  const actors =
    files.actors && hero
      ? {
          ...files.actors,
          entries: [
            ...files.actors.entries,
            ...extraActors.map((id) => ({ ...hero, id, name: id })),
          ],
        }
      : files.actors;
  return new DatabaseIndex(assembleDatabase({ ...files, ...(actors ? { actors } : {}) }));
}
