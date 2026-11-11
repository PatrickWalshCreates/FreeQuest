// The editor's clipboard: commands, a map event or a database entry,
// copied as plain data. It lives as long as the editor (not the project),
// so pasting into another project works; what the copy refers to (switches,
// characters, items…) keeps its ids and shows as a problem if missing there.
import type { Command, GameMap, MapEvent } from '@freequest/schema';
import {
  type EntriesFile,
  type Entry,
  type EntryKind,
  addEntry,
  uniqueId,
} from './database-edits.js';
import { getList, nextEventId, updateList, type ListPath } from './event-edits.js';

export type ClipboardContent =
  | { readonly kind: 'commands'; readonly commands: readonly Command[] }
  | { readonly kind: 'event'; readonly event: MapEvent }
  | { readonly kind: 'entry'; readonly category: EntryKind; readonly entry: Entry };

/** A deep copy, so nothing pasted shares objects with where it came from. */
function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class EditorClipboard {
  private value: ClipboardContent | null = null;
  private readonly listeners = new Set<() => void>();
  /** Bumped on every copy (for React's useSyncExternalStore). */
  version = 0;

  get content(): ClipboardContent | null {
    return this.value;
  }

  set(content: ClipboardContent): void {
    this.value = copy(content);
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  commands(): readonly Command[] | null {
    return this.value?.kind === 'commands' ? copy(this.value.commands) : null;
  }

  event(): MapEvent | null {
    return this.value?.kind === 'event' ? copy(this.value.event) : null;
  }

  /** The copied entry, if it is one of `category`. */
  entry(category: EntryKind): Entry | null {
    return this.value?.kind === 'entry' && this.value.category === category
      ? copy(this.value.entry)
      : null;
  }
}

/** The editor's one clipboard. */
export const clipboard = new EditorClipboard();

// Commands ------------------------------------------------------------------

/** `count` commands starting at `index` of the list at `path`. */
export function sliceCommands(
  commands: readonly Command[],
  path: ListPath,
  index: number,
  count: number,
): Command[] {
  return getList(commands, path).slice(index, index + count);
}

/** Insert several commands at `index` of the list at `path`. */
export function insertCommands(
  commands: readonly Command[],
  path: ListPath,
  index: number,
  inserted: readonly Command[],
): Command[] {
  return updateList(commands, path, (list) => [
    ...list.slice(0, index),
    ...inserted,
    ...list.slice(index),
  ]);
}

/** Remove `count` commands starting at `index` of the list at `path`. */
export function removeCommands(
  commands: readonly Command[],
  path: ListPath,
  index: number,
  count: number,
): Command[] {
  return updateList(commands, path, (list) =>
    list.filter((_, i) => i < index || i >= index + count),
  );
}

// Events --------------------------------------------------------------------

/** The free cell (no event on it) nearest to (x, y), or null if the map is full. */
export function nearestFreeCell(
  map: GameMap,
  x: number,
  y: number,
): { x: number; y: number } | null {
  const taken = new Set(map.events.map((e) => `${e.x},${e.y}`));
  const cx = Math.min(Math.max(0, x), map.width - 1);
  const cy = Math.min(Math.max(0, y), map.height - 1);
  const maxRadius = Math.max(map.width, map.height);
  for (let r = 0; r <= maxRadius; r++) {
    let best: { x: number; y: number; d: number } | null = null;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const px = cx + dx;
        const py = cy + dy;
        if (px < 0 || py < 0 || px >= map.width || py >= map.height) continue;
        if (taken.has(`${px},${py}`)) continue;
        const d = dx * dx + dy * dy;
        if (!best || d < best.d) best = { x: px, y: py, d };
      }
    }
    if (best) return { x: best.x, y: best.y };
  }
  return null;
}

/**
 * Add a copied event to a map at the free cell nearest (x, y), under a new id
 * (it keeps its name, pages and everything they refer to).
 */
export function pasteEvent(
  map: GameMap,
  event: MapEvent,
  x: number,
  y: number,
): { map: GameMap; id: string } {
  const cell = nearestFreeCell(map, x, y);
  if (!cell) throw new Error('Every cell of this map already has an event');
  const id = nextEventId(map);
  const pasted: MapEvent = { ...copy(event), id, x: cell.x, y: cell.y };
  return { map: { ...map, events: [...map.events, pasted] }, id };
}

// Database entries ----------------------------------------------------------

/**
 * Add a copied entry after `after` (or at the end). It keeps its id when the
 * id is free, so references to it still match in another project; otherwise
 * it gets `<id>-2`… and "(copy)" after its name.
 */
export function pasteEntry<F extends EntriesFile>(
  file: F,
  entry: Entry,
  after?: string,
): { file: F; id: string } {
  const ids = file.entries.map((e) => e.id);
  const id = uniqueId(entry.id, ids);
  const pasted: Entry =
    id === entry.id ? copy(entry) : { ...copy(entry), id, name: `${entry.name} (copy)` };
  return { file: addEntry(file, pasted, after), id };
}
