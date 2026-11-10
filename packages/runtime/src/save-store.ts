import { type SaveFile, parseProjectFile } from '@freequest/schema';

/** How many save slots the menus offer. */
export const SAVE_SLOTS = 3;

/** The subset of the Web Storage API the save store needs (localStorage fits). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What a save slot holds, for slot lists. */
export type SlotInfo =
  | { readonly slot: number; readonly kind: 'empty' }
  | { readonly slot: number; readonly kind: 'save'; readonly save: SaveFile }
  | { readonly slot: number; readonly kind: 'broken'; readonly reason: string };

/** Which game the saves belong to: the manifest's id and name. */
export interface SaveGame {
  readonly id: string;
  /** Saves from before games had ids were keyed and tagged by name; they still load. */
  readonly name: string;
}

/**
 * Save slots on top of a key-value storage, kept per game id. Reads migrate
 * and validate like project files; damaged data or a save from another
 * game shows as a broken slot instead of throwing. Synchronous so menus
 * stay simple state machines (a desktop build can preload its files).
 */
export class SaveStore {
  constructor(
    private readonly storage: KeyValueStorage,
    /** The game; its id keys the slots and guards against loading another game's save. */
    private readonly game: SaveGame,
    readonly slots = SAVE_SLOTS,
  ) {}

  private checkSlot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 1 || slot > this.slots) {
      throw new Error(`no save slot ${slot}`);
    }
  }

  private key(slot: number): string {
    this.checkSlot(slot);
    return `freequest:game:${this.game.id}:save:${slot}`;
  }

  /** Where saves lived before game ids (keyed by name). */
  private legacyKey(slot: number): string {
    this.checkSlot(slot);
    return `freequest:${encodeURIComponent(this.game.name)}:save:${slot}`;
  }

  read(slot: number): SlotInfo {
    const key = this.key(slot); // an invalid slot number is a bug: let it throw
    const legacy = this.legacyKey(slot);
    let text: string | null;
    try {
      text = this.storage.getItem(key) ?? this.storage.getItem(legacy);
    } catch (error) {
      return { slot, kind: 'broken', reason: `storage unavailable (${String(error)})` };
    }
    if (text === null) return { slot, kind: 'empty' };
    try {
      const save = parseProjectFile('save', JSON.parse(text), `save slot ${slot}`);
      if (save.game !== this.game.id && save.game !== this.game.name) {
        return { slot, kind: 'broken', reason: `saved by another game ("${save.game}")` };
      }
      return { slot, kind: 'save', save };
    } catch (error) {
      return {
        slot,
        kind: 'broken',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Every slot, in order. */
  list(): SlotInfo[] {
    return Array.from({ length: this.slots }, (_, i) => this.read(i + 1));
  }

  /** The most recently saved slot, if any (for "Continue"). */
  latest(): Extract<SlotInfo, { kind: 'save' }> | null {
    let best: Extract<SlotInfo, { kind: 'save' }> | null = null;
    for (const info of this.list()) {
      if (info.kind === 'save' && (!best || info.save.savedAt > best.save.savedAt)) best = info;
    }
    return best;
  }

  /** Write a save. Throws (e.g. storage full or blocked) so the menu can report it. */
  write(slot: number, save: SaveFile): void {
    this.storage.setItem(this.key(slot), JSON.stringify(save));
    // The slot now lives under the id; drop any copy left under the old name key.
    this.storage.removeItem(this.legacyKey(slot));
  }

  remove(slot: number): void {
    this.storage.removeItem(this.key(slot));
    this.storage.removeItem(this.legacyKey(slot));
  }
}

/** In-memory storage: tests, and a fallback when localStorage is unavailable. */
export class MemoryStorage implements KeyValueStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
