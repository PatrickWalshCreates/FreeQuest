// Renaming ids. Everything in a project refers to things by id, so changing
// one means changing every reference too: the reference index (`usages.ts`)
// says where each is, and this rewrites them all, with the thing's own id, in
// one undo step. Kinds that saves store also go into the manifest's rename
// record, so players' saves made before the rename still load.
import {
  ID_PATTERN,
  type Manifest,
  SAVE_RENAME_KINDS,
  type SaveRenameKind,
  type DatabaseKind,
} from '@freequest/schema';
import type { ProjectDocument, Transaction } from './document.js';
import { MANIFEST_PATH, type OpenedProject } from './open-project.js';
import { type DataPath, type RefKind, type Reference, projectReferences } from './usages.js';

/** What can be renamed (assets are moved instead: M12 step 4). */
export type RenameKind = Exclude<RefKind, 'asset'>;

const ID_RE = new RegExp(ID_PATTERN);

/** Database categories holding each kind of entry. */
const ENTRY_FILES: Partial<Record<RenameKind, DatabaseKind>> = {
  actor: 'actors',
  class: 'classes',
  skill: 'skills',
  item: 'items',
  equipment: 'equipment',
  state: 'states',
  enemy: 'enemies',
  troop: 'troops',
  commonEvent: 'commonEvents',
};

/** System lists holding each kind of type. */
const SYSTEM_LISTS: Partial<
  Record<RenameKind, 'elements' | 'equipmentSlots' | 'equipmentTypes' | 'skillTypes'>
> = {
  element: 'elements',
  equipmentSlot: 'equipmentSlots',
  equipmentType: 'equipmentTypes',
  skillType: 'skillTypes',
};

/** Text code names for kinds that text can mention. */
const TEXT_CODES: Partial<Record<RenameKind, string>> = {
  variable: 'v',
  actor: 'actor',
  item: 'item',
  equipment: 'equipment',
};

/** The ids already in use for a kind (events: on the same map), to refuse a clash. */
function takenIds(project: OpenedProject, kind: RenameKind, oldId: string): string[] {
  const m = project.manifest.data;
  if (kind === 'switch' || kind === 'variable')
    return [...m.switches, ...m.variables].map((d) => d.id);
  if (kind === 'map') return m.maps.map((r) => r.id);
  if (kind === 'tileset') return m.tilesets.map((r) => r.id);
  if (kind === 'character') return m.characters.map((r) => r.id);
  if (kind === 'event') {
    const [mapId] = oldId.split('/');
    return (project.maps.get(mapId ?? '')?.data?.events ?? []).map((e) => e.id);
  }
  const category = ENTRY_FILES[kind];
  if (category) {
    const entries = project.database[category]?.data as { entries?: { id: string }[] } | undefined;
    return entries?.entries?.map((e) => e.id) ?? [];
  }
  const list = SYSTEM_LISTS[kind];
  return list ? (project.database.system?.data?.[list] ?? []).map((d) => d.id) : [];
}

/** Why `newId` can't replace `oldId`, or null when it can. Events take a bare id. */
export function renameProblem(
  project: OpenedProject,
  kind: RenameKind,
  oldId: string,
  newId: string,
): string | null {
  const bare = kind === 'event' ? oldId.slice(oldId.indexOf('/') + 1) : oldId;
  if (newId === bare) return 'That’s its id already';
  if (!ID_RE.test(newId))
    return 'Use lowercase letters, digits, "-" and "_" (starting with a letter or digit)';
  if (takenIds(project, kind, oldId).includes(newId)) return `"${newId}" is already used`;
  return null;
}

/** Copy `data` with the value at `path` replaced by `change(value)`. */
function setAt(data: unknown, path: DataPath, change: (value: unknown) => unknown): unknown {
  const [step, ...rest] = path;
  if (step === undefined) return change(data);
  if (Array.isArray(data) && typeof step === 'number') {
    return data.map((item, i) => (i === step ? setAt(item, rest, change) : item));
  }
  if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    return { ...obj, [step]: setAt(obj[step], rest, change) };
  }
  return data;
}

/** Rename an object key (an actor's equipment slot), keeping the key order. */
function renameKey(obj: unknown, from: string, to: string): unknown {
  if (!obj || typeof obj !== 'object') return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');

/** Apply the rewrites for one file's references. */
function rewrite(
  data: unknown,
  refs: readonly Reference[],
  kind: RenameKind,
  oldValue: string,
  newValue: string,
): unknown {
  let out = data;
  for (const ref of refs) {
    if (ref.isKey) {
      out = setAt(out, ref.path.slice(0, -1), (obj) => renameKey(obj, oldValue, newValue));
    } else if (ref.inText) {
      const code = TEXT_CODES[kind];
      if (!code) continue;
      const pattern = new RegExp(`\\{(\\s*${code}\\s*:\\s*)${escapeRe(oldValue)}(\\s*)\\}`, 'g');
      out = setAt(out, ref.path, (text) =>
        typeof text === 'string' ? text.replace(pattern, `{$1${newValue}$2}`) : text,
      );
    } else {
      out = setAt(out, ref.path, (value) => (value === oldValue ? newValue : value));
    }
  }
  return out;
}

/** The manifest's rename record with `from → to` added (chains collapse; renaming back removes it). */
export function recordRename(
  manifest: Manifest,
  kind: SaveRenameKind,
  from: string,
  to: string,
): Manifest {
  const all = manifest.renames ?? {};
  // Earlier renames into `from` now lead to `to`; a rename back to an old name drops out.
  const table = Object.fromEntries(
    [
      ...Object.entries(all[kind] ?? {}).map(([a, b]) => [a, b === from ? to : b] as const),
      [from, to] as const,
    ].filter(([a, b]) => a !== b),
  );
  const next = Object.fromEntries(
    Object.entries({ ...all, [kind]: table }).filter(([, t]) => Object.keys(t ?? {}).length > 0),
  );
  if (Object.keys(next).length > 0) return { ...manifest, renames: next };
  const { renames: _gone, ...rest } = manifest;
  return rest;
}

/**
 * Rename one thing's id everywhere, as one undo step. `oldId` for an event
 * is "<map>/<event>" and `newId` is the bare new event id. Returns how many
 * references were rewritten. Throws with the problem if the new id can't be used.
 */
export function renameId(
  doc: ProjectDocument,
  kind: RenameKind,
  oldId: string,
  newId: string,
): number {
  const project = doc.project;
  const problem = renameProblem(project, kind, oldId, newId);
  if (problem) throw new Error(problem);
  const mapOfEvent = kind === 'event' ? oldId.slice(0, oldId.indexOf('/')) : null;
  const oldValue = mapOfEvent ? oldId.slice(mapOfEvent.length + 1) : oldId;
  const refs = projectReferences(project).filter((r) => r.kind === kind && r.id === oldId);
  const byFile = new Map<string, Reference[]>();
  for (const ref of refs) byFile.set(ref.file, [...(byFile.get(ref.file) ?? []), ref]);

  doc.edit(`Rename ${oldValue} to ${newId}`, (tx) => {
    for (const [path, fileRefs] of byFile) {
      const file = tx.file(path);
      if (!file?.data) continue;
      tx.update(path, file.kind, (data) => rewrite(data, fileRefs, kind, oldValue, newId) as never);
    }
    renameDeclaration(tx, project, kind, oldValue, newId, mapOfEvent);
    if ((SAVE_RENAME_KINDS as readonly string[]).includes(kind)) {
      const from = mapOfEvent ? `${mapOfEvent}/${oldValue}` : oldValue;
      const to = mapOfEvent ? `${mapOfEvent}/${newId}` : newId;
      tx.update(MANIFEST_PATH, 'manifest', (m) =>
        recordRename(m, kind as SaveRenameKind, from, to),
      );
    }
  });
  return refs.length;
}

/** Change the thing's own id where it's declared. */
function renameDeclaration(
  tx: Transaction,
  project: OpenedProject,
  kind: RenameKind,
  oldId: string,
  newId: string,
  mapOfEvent: string | null,
): void {
  const swap = <T extends { id: string }>(list: readonly T[]) =>
    list.map((item) => (item.id === oldId ? { ...item, id: newId } : item));
  if (kind === 'switch' || kind === 'variable') {
    const key = kind === 'switch' ? 'switches' : 'variables';
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({ ...m, [key]: swap(m[key]) }));
    return;
  }
  if (kind === 'map' || kind === 'tileset' || kind === 'character') {
    const key = kind === 'map' ? 'maps' : kind === 'tileset' ? 'tilesets' : 'characters';
    const ref = project.manifest.data[key].find((r) => r.id === oldId);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({ ...m, [key]: swap(m[key]) }));
    if (ref) {
      const file = tx.file(ref.path);
      if (file?.data) {
        tx.update(ref.path, file.kind, (data) => ({ ...(data as object), id: newId }) as never, {
          id: newId,
        });
      }
    }
    return;
  }
  if (kind === 'event' && mapOfEvent) {
    const path = project.maps.get(mapOfEvent)?.path;
    if (path) tx.update(path, 'map', (m) => ({ ...m, events: swap(m.events) }));
    return;
  }
  const category = ENTRY_FILES[kind];
  const file = category && project.database[category];
  if (category && file) {
    tx.update(
      file.path,
      category,
      (d) => ({ ...d, entries: swap((d as { entries: { id: string }[] }).entries) }) as never,
    );
    return;
  }
  const list = SYSTEM_LISTS[kind];
  const system = project.database.system;
  if (list && system) tx.update(system.path, 'system', (s) => ({ ...s, [list]: swap(s[list]) }));
}
