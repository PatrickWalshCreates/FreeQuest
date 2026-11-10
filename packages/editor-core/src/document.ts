import { DATABASE_KINDS, type FileData, stableStringify } from '@freequest/schema';
import {
  type DataFileKind,
  MANIFEST_PATH,
  type OpenedProject,
  type Problem,
  type ProjectFile,
  allFiles,
  checkProject,
  contentProblems,
  schemaProblems,
} from './open-project.js';
import type { ProjectFs } from './project-fs.js';

/** How many undo steps are kept. */
export const HISTORY_LIMIT = 200;

interface Change {
  readonly before: unknown;
  after: unknown;
}

interface HistoryEntry {
  readonly label: string;
  readonly changes: Map<string, Change>;
  readonly coalesce: string | null;
}

export interface EditOptions {
  /**
   * Edits with the same key merge into one undo step until
   * `endCoalescing()` (e.g. one paint stroke, or typing in one field).
   */
  readonly coalesce?: string;
}

export interface SaveResult {
  /** Paths written, in write order. */
  readonly written: readonly string[];
}

/** Saving was refused because some changed files don't match the schema (nothing was written). */
export class SaveBlockedError extends Error {
  override name = 'SaveBlockedError';
  constructor(readonly problems: readonly Problem[]) {
    super(`Not saved:\n  ${problems.map((p) => `${p.source}: ${p.message}`).join('\n  ')}`);
  }
}

/**
 * An open project being edited: the current contents of every file, an
 * undo/redo history, and which files differ from disk.
 *
 * File data is immutable. An edit replaces a file's data with a new object
 * (sharing unchanged parts), so history entries are just before/after
 * references and "unchanged" is an identity check; undoing back to the
 * saved state makes a file clean again.
 *
 * Saving refuses files that fail the schema (writing them would make the
 * project unloadable), and writes nothing in that case; forms should keep
 * that from happening. Other problems, such as a
 * broken reference, are reported through `project.problems` but don't block
 * saving, so work is never stuck unsaved.
 */
export class ProjectDocument {
  readonly fs: ProjectFs;
  private readonly files = new Map<string, ProjectFile>();
  /** Data as it is on disk; a file in an older format starts out different from anything. */
  private readonly saved = new Map<string, unknown>();
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private coalescing: string | null = null;
  private readonly listeners = new Set<() => void>();
  private view: { readonly version: number; readonly project: OpenedProject } | null = null;
  private saveQueue: Promise<unknown> = Promise.resolve();
  private savesInFlight = 0;
  /** Bumped on every change (edits, undo, redo, saves). */
  version = 0;

  constructor(opened: OpenedProject) {
    this.fs = opened.fs;
    for (const file of allFiles(opened)) {
      this.files.set(file.path, file);
      this.saved.set(file.path, file.migrated ? NEEDS_UPGRADE : file.data);
    }
  }

  /** The project as it is now, in the same shape `openProject` returns. */
  get project(): OpenedProject {
    if (this.view?.version !== this.version) {
      this.view = { version: this.version, project: this.buildView() };
    }
    return this.view.project;
  }

  file(path: string): ProjectFile | undefined {
    return this.files.get(path);
  }

  /** Call `listener` after every change. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Replace a file's data with `change(data)`. Returning the same object is
   * a no-op (no undo step). Returns whether anything changed.
   */
  update<K extends DataFileKind>(
    path: string,
    kind: K,
    label: string,
    change: (data: FileData<K>) => FileData<K>,
    options: EditOptions = {},
  ): boolean {
    const file = this.files.get(path);
    if (!file) throw new Error(`"${path}" is not part of this project`);
    if (file.kind !== kind) throw new Error(`"${path}" is a ${file.kind} file, not ${kind}`);
    if (file.data === null) throw new Error(`"${path}" could not be loaded, so it can't be edited`);
    const before = file.data as FileData<K>;
    const after = change(before);
    if (after === before) return false;
    this.commit(label, new Map([[path, { before, after }]]), options.coalesce ?? null);
    return true;
  }

  /** Close the current coalescing group: the next edit starts a new undo step. */
  endCoalescing(): void {
    this.coalescing = null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Label of the step `undo()` would revert, e.g. "Paint tiles". */
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }

  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  /** Revert the last step. Returns its label, or null when there is nothing to undo. */
  undo(): string | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.coalescing = null;
    for (const [path, { before }] of entry.changes) this.setData(path, before);
    this.redoStack.push(entry);
    this.changed();
    return entry.label;
  }

  redo(): string | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.coalescing = null;
    for (const [path, { after }] of entry.changes) this.setData(path, after);
    this.undoStack.push(entry);
    this.changed();
    return entry.label;
  }

  isDirty(path: string): boolean {
    return this.saved.has(path) && this.saved.get(path) !== this.files.get(path)?.data;
  }

  /** Files that differ from disk, in project order. */
  get dirtyPaths(): string[] {
    return [...this.files.keys()].filter((path) => this.isDirty(path));
  }

  get dirty(): boolean {
    return this.dirtyPaths.length > 0;
  }

  /**
   * Write every changed file (in canonical form via `stableStringify`).
   * Data files are written before project.json, so an interrupted save
   * never leaves the manifest pointing at a file that isn't there yet.
   * Edits made while saving stay unsaved. Saves run one at a time.
   */
  save(): Promise<SaveResult> {
    // When idle, start at once so the save captures exactly what is on screen now.
    const run = this.savesInFlight > 0 ? this.saveQueue.then(() => this.saveNow()) : this.saveNow();
    this.savesInFlight += 1;
    this.saveQueue = run.catch(() => undefined).finally(() => (this.savesInFlight -= 1));
    return run;
  }

  private async saveNow(): Promise<SaveResult> {
    this.endCoalescing();
    const pending = this.dirtyPaths
      .sort((a, b) => Number(a === MANIFEST_PATH) - Number(b === MANIFEST_PATH))
      .map((path) => {
        const file = this.files.get(path);
        if (!file) throw new Error(`"${path}" is not part of this project`);
        return file;
      });
    const blocked = pending.flatMap((file) =>
      schemaProblems(file.kind, file.data, file.path).map((message) => ({
        source: file.path,
        message,
      })),
    );
    if (blocked.length > 0) throw new SaveBlockedError(blocked);

    const written: string[] = [];
    try {
      for (const file of pending) {
        await this.fs.writeText(file.path, stableStringify(file.data));
        this.saved.set(file.path, file.data);
        const current = this.files.get(file.path);
        if (current?.migrated) this.files.set(file.path, { ...current, migrated: false });
        written.push(file.path);
      }
    } finally {
      if (written.length > 0) this.changed();
    }
    return { written };
  }

  private commit(label: string, changes: Map<string, Change>, coalesce: string | null): void {
    const top = this.undoStack.at(-1);
    if (coalesce !== null && top && this.coalescing === coalesce && top.coalesce === coalesce) {
      for (const [path, change] of changes) {
        const existing = top.changes.get(path);
        if (existing) existing.after = change.after;
        else top.changes.set(path, change);
      }
      // Typing a name and then deleting back to the original is no step at all:
      // drop it and restore the original objects, so the file is clean again.
      if ([...top.changes.values()].every((c) => deepEqual(c.before, c.after))) {
        this.undoStack.pop();
        for (const [path, { before }] of top.changes) this.setData(path, before);
        this.coalescing = null;
        this.redoStack = [];
        this.changed();
        return;
      }
    } else {
      this.undoStack.push({ label, changes, coalesce });
      if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    }
    this.coalescing = coalesce;
    this.redoStack = [];
    for (const [path, { after }] of changes) this.setData(path, after);
    this.changed();
  }

  private setData(path: string, data: unknown): void {
    const file = this.files.get(path);
    if (!file) throw new Error(`"${path}" is not part of this project`);
    const invalid = schemaProblems(file.kind, data, path);
    const problems = invalid.length > 0 ? invalid : contentProblems(file.kind, data, file.id);
    this.files.set(path, { ...file, data: data as ProjectFile['data'], problems });
  }

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  /** Group the current files the way the manifest lists them. */
  private buildView(): OpenedProject {
    const manifest = this.files.get(MANIFEST_PATH) as OpenedProject['manifest'];
    const m = manifest.data;
    const byRefs = <K extends 'tileset' | 'map' | 'character'>(
      refs: readonly { id: string; path: string }[],
    ) =>
      new Map(
        refs.flatMap((ref) => {
          const file = this.files.get(ref.path);
          return file ? [[ref.id, file as ProjectFile<K>] as const] : [];
        }),
      );
    const database = Object.fromEntries(
      DATABASE_KINDS.flatMap((kind) => {
        const path = m.database?.[kind];
        const file = path === undefined ? undefined : this.files.get(path);
        return file ? [[kind, file]] : [];
      }),
    ) as OpenedProject['database'];
    const files = {
      manifest,
      tilesets: byRefs<'tileset'>(m.tilesets),
      maps: byRefs<'map'>(m.maps),
      characters: byRefs<'character'>(m.characters),
      database,
    };
    return { fs: this.fs, ...files, problems: checkProject(files) };
  }
}

/** Structural equality of JSON data; shared (unchanged) subtrees short-circuit by identity. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every(
    (k) =>
      Object.hasOwn(b, k) &&
      deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

/** Never equal to any file's data, so a file in an older format counts as changed until saved. */
const NEEDS_UPGRADE = Symbol('needs format upgrade');
