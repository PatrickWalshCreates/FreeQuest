// Database entries (actors, items, enemies…): new, duplicate, delete,
// reorder, all pure functions over a category file's data.
import { DATABASE_KINDS, type DatabaseKind, SCHEMAS } from '@freequest/schema';
import { type DefaultPicker, type JsonSchema, asSchema, defaultFor } from './schema-form.js';

/** Categories stored as `{ formatVersion, entries: [...] }` (everything but system). */
export type EntryKind = Exclude<DatabaseKind, 'system'>;
export const ENTRY_KINDS = DATABASE_KINDS.filter((k): k is EntryKind => k !== 'system');

export interface Entry {
  readonly id: string;
  readonly name: string;
}

type EntriesFile = { readonly formatVersion: number; readonly entries: readonly Entry[] };

/** The schema of one entry of a category. */
export function entrySchema(kind: EntryKind): JsonSchema {
  const items = asSchema(SCHEMAS[kind]).properties?.['entries']?.items;
  if (!items) throw new Error(`no entry schema for ${kind}`);
  return items;
}

export const ID_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

/** "Fire Ball!" → "fire-ball": a valid id from a display name. */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return slug || 'entry';
}

/** `base`, or `base-2`, `base-3`… whichever isn't taken. */
export function uniqueId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

/** Why `id` can't be a new entry's id, or null when it can. */
export function idProblem(id: string, file: EntriesFile): string | null {
  if (!ID_PATTERN.test(id))
    return 'Use lowercase letters, digits, "-" and "_" (starting with a letter or digit)';
  if (file.entries.some((e) => e.id === id)) return `"${id}" is already used`;
  return null;
}

/** A new entry with every required field filled in (references from `pick`). */
export function newEntry(kind: EntryKind, id: string, name: string, pick: DefaultPicker): Entry {
  return { ...(defaultFor(entrySchema(kind), pick) as object), id, name } as Entry;
}

function withEntries<F extends EntriesFile>(file: F, entries: readonly Entry[]): F {
  return { ...file, entries };
}

function indexOf(file: EntriesFile, id: string): number {
  const index = file.entries.findIndex((e) => e.id === id);
  if (index === -1) throw new Error(`no entry "${id}"`);
  return index;
}

export function addEntry<F extends EntriesFile>(file: F, entry: Entry, after?: string): F {
  const problem = idProblem(entry.id, file);
  if (problem) throw new Error(problem);
  const at = after === undefined ? file.entries.length : indexOf(file, after) + 1;
  return withEntries(file, [...file.entries.slice(0, at), entry, ...file.entries.slice(at)]);
}

/** Copy an entry right after itself, as "<name> (copy)" with a fresh id. Returns the new id too. */
export function duplicateEntry<F extends EntriesFile>(
  file: F,
  id: string,
): { file: F; id: string } {
  const source = file.entries[indexOf(file, id)] as Entry;
  const copyId = uniqueId(
    `${id}-copy`,
    file.entries.map((e) => e.id),
  );
  return {
    file: addEntry(file, { ...source, id: copyId, name: `${source.name} (copy)` }, id),
    id: copyId,
  };
}

export function replaceEntry<F extends EntriesFile>(file: F, id: string, entry: Entry): F {
  const index = indexOf(file, id);
  if (entry.id !== id) throw new Error('An entry’s id can’t be changed here');
  return file.entries[index] === entry
    ? file
    : withEntries(
        file,
        file.entries.map((e, i) => (i === index ? entry : e)),
      );
}

export function removeEntry<F extends EntriesFile>(file: F, id: string): F {
  indexOf(file, id);
  return withEntries(
    file,
    file.entries.filter((e) => e.id !== id),
  );
}

/** Move an entry up or down the list (the order menus and lists show). */
export function moveEntry<F extends EntriesFile>(file: F, id: string, delta: number): F {
  const index = indexOf(file, id);
  const target = index + delta;
  if (target < 0 || target >= file.entries.length) return file;
  const entries = file.entries.filter((_, i) => i !== index);
  entries.splice(target, 0, file.entries[index] as Entry);
  return withEntries(file, entries);
}
