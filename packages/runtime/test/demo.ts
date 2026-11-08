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

export function demoDb(): DatabaseIndex {
  const files = Object.fromEntries(
    DATABASE_KINDS.map((k) => [k, parseProjectFile(k, readDemo(`data/database/${k}.json`))]),
  ) as DatabaseFiles;
  return new DatabaseIndex(assembleDatabase(files));
}
