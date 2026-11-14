// Character sheet edits: pure functions over sheet data, plus creating and
// deleting character files. A sheet is one row per direction (`rows` order)
// of `frames` columns; the walk cycle and the standing frame are columns.
import {
  CHARACTER_FORMAT_VERSION,
  type CharacterSheet,
  type Direction,
  idFromName,
} from '@freequest/schema';
import type { ProjectDocument } from './document.js';
import { MANIFEST_PATH, type OpenedProject } from './open-project.js';
import { usagesOf } from './usages.js';

export const CHARACTER_DIR = 'data/characters';

/** The usual layout: facing the viewer first. */
export const DEFAULT_ROWS: readonly Direction[] = ['down', 'left', 'right', 'up'];

export function characterPath(id: string): string {
  return `${CHARACTER_DIR}/${id}.json`;
}

/** A walk cycle that suits `frames` columns: 3 frames step out and back (0 1 2 1). */
export function defaultWalkCycle(frames: number): number[] {
  if (frames === 3) return [0, 1, 2, 1];
  return Array.from({ length: Math.max(1, frames) }, (_, i) => i);
}

/** The usual standing frame: the middle one of three, else the first. */
export function defaultIdleFrame(frames: number): number {
  return frames === 3 ? 1 : 0;
}

/** Columns of whole frames, and rows of them, that an image holds. */
export function frameGrid(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): { frames: number; rows: number } {
  return {
    frames: Math.max(1, Math.floor(imageWidth / frameWidth)),
    rows: Math.floor(imageHeight / frameHeight),
  };
}

/** Why the image can't hold the sheet (four rows of frames), or null. */
export function sheetImageProblem(
  sheet: CharacterSheet,
  imageWidth: number,
  imageHeight: number,
): string | null {
  const { frames, rows } = frameGrid(imageWidth, imageHeight, sheet.frameWidth, sheet.frameHeight);
  if (rows < 4) {
    return `The image holds ${rows} row${rows === 1 ? '' : 's'} of ${sheet.frameHeight} px frames; a sheet needs 4 (one per direction).`;
  }
  if (frames < sheet.frames) {
    return `The image is ${frames} frame${frames === 1 ? '' : 's'} wide, but the sheet uses ${sheet.frames}.`;
  }
  return null;
}

/**
 * Cut the image into frames of a size: as many columns as fit. Frame numbers
 * the new width doesn't have are reset to the defaults for it.
 */
export function fitCharacter(
  sheet: CharacterSheet,
  imageWidth: number,
  imageHeight: number,
  frameWidth = sheet.frameWidth,
  frameHeight = sheet.frameHeight,
): CharacterSheet {
  const { frames } = frameGrid(imageWidth, imageHeight, frameWidth, frameHeight);
  const cycleFits = sheet.walkCycle.every((f) => f < frames);
  const next: CharacterSheet = {
    ...sheet,
    frameWidth,
    frameHeight,
    frames,
    idleFrame: sheet.idleFrame < frames ? sheet.idleFrame : defaultIdleFrame(frames),
    walkCycle: cycleFits ? sheet.walkCycle : defaultWalkCycle(frames),
  };
  const same =
    next.frameWidth === sheet.frameWidth &&
    next.frameHeight === sheet.frameHeight &&
    next.frames === sheet.frames &&
    next.idleFrame === sheet.idleFrame &&
    next.walkCycle === sheet.walkCycle;
  return same ? sheet : next;
}

/** Read a walk cycle typed as "0 1 2 1" (spaces or commas). */
export function parseFrameList(
  text: string,
  frames: number,
): { readonly value: number[] } | { readonly problem: string } {
  const parts = text.split(/[\s,]+/).filter((p) => p !== '');
  if (parts.length === 0) return { problem: 'List at least one frame' };
  const value: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return { problem: `"${part}" isn't a frame number` };
    const n = Number(part);
    if (n >= frames) return { problem: `Frame ${n} doesn't exist (0 to ${frames - 1})` };
    value.push(n);
  }
  return { value };
}

/** Swap a direction's row with its neighbour (`delta` −1 = up, +1 = down). */
export function moveRow(sheet: CharacterSheet, index: number, delta: -1 | 1): CharacterSheet {
  const target = index + delta;
  const rows = [...sheet.rows];
  const a = rows[index];
  const b = rows[target];
  if (a === undefined || b === undefined) return sheet;
  rows[index] = b;
  rows[target] = a;
  return { ...sheet, rows };
}

/** Everything that shows a character: the player, actors and event pages. */
export function characterUsages(project: OpenedProject, id: string): string[] {
  return usagesOf(project, 'character', id);
}

export interface NewCharacterOptions {
  readonly name: string;
  readonly image: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/** A free character id from the name, whose file path is free too. */
export function nextCharacterId(doc: ProjectDocument, name: string): string {
  const taken = new Set(doc.project.manifest.data.characters.map((c) => c.id));
  const base = idFromName(name, 'character');
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(id) && !doc.file(characterPath(id))) return id;
  }
}

/** Add a character sheet cut from an image (usual row order and walk cycle). Returns its id. */
export function createCharacter(doc: ProjectDocument, options: NewCharacterOptions): string {
  const name = options.name.trim();
  if (!name) throw new Error('Give the character a name');
  for (const n of [options.frameWidth, options.frameHeight]) {
    if (!Number.isInteger(n) || n < 1) throw new Error('Frame sizes must be whole numbers above 0');
  }
  const { frames, rows } = frameGrid(
    options.imageWidth,
    options.imageHeight,
    options.frameWidth,
    options.frameHeight,
  );
  if (options.frameWidth > options.imageWidth || rows < 4) {
    throw new Error(
      `The image needs room for 4 rows of ${options.frameWidth} × ${options.frameHeight} px frames`,
    );
  }
  const id = nextCharacterId(doc, name);
  const sheet: CharacterSheet = {
    formatVersion: CHARACTER_FORMAT_VERSION,
    id,
    name,
    image: options.image,
    frameWidth: options.frameWidth,
    frameHeight: options.frameHeight,
    frames,
    rows: [...DEFAULT_ROWS],
    idleFrame: defaultIdleFrame(frames),
    walkCycle: defaultWalkCycle(frames),
  };
  const path = characterPath(id);
  doc.edit('New character', (tx) => {
    tx.create(path, 'character', id, sheet);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      characters: [...m.characters, { id, path }],
    }));
  });
  return id;
}

/** Remove a character nothing shows (its file is deleted on save). */
export function deleteCharacter(doc: ProjectDocument, id: string): void {
  const uses = characterUsages(doc.project, id);
  if (uses.length > 0) throw new Error(`Still used by ${uses.join(', ')}`);
  const entry = doc.project.manifest.data.characters.find((c) => c.id === id);
  if (!entry) throw new Error(`Unknown character "${id}"`);
  doc.edit('Delete character', (tx) => {
    tx.remove(entry.path);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      characters: m.characters.filter((c) => c.id !== id),
    }));
  });
}
