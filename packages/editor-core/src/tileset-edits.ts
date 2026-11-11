// Tileset edits: pure functions over tileset data, plus creating and
// deleting tileset files. Tile index i is column i % columns, row
// floor(i / columns) of the image, so the grid (tile size, columns) decides
// which picture every map cell shows; flags and names follow the index.
import { TILESET_FORMAT_VERSION, type Tile, type Tileset, idFromName } from '@freequest/schema';
import type { ProjectDocument } from './document.js';
import { MANIFEST_PATH, type OpenedProject } from './open-project.js';

export const TILESET_DIR = 'data/tilesets';

export function tilesetPath(id: string): string {
  return `${TILESET_DIR}/${id}.json`;
}

/** Columns and rows of whole tiles an image holds (at least 1×1). */
export function tileGrid(
  imageWidth: number,
  imageHeight: number,
  tileWidth: number,
  tileHeight: number,
): { columns: number; rows: number } {
  return {
    columns: Math.max(1, Math.floor(imageWidth / tileWidth)),
    rows: Math.max(1, Math.floor(imageHeight / tileHeight)),
  };
}

const NEW_TILE: Tile = { passable: true };

/**
 * Cut the image into tiles of the given size: columns from the image width,
 * one tile per cell. Existing tiles keep their flags and names by index; new
 * ones are walkable.
 */
export function fitTileset(
  tileset: Tileset,
  imageWidth: number,
  imageHeight: number,
  tileWidth = tileset.tileWidth,
  tileHeight = tileset.tileHeight,
): Tileset {
  const { columns, rows } = tileGrid(imageWidth, imageHeight, tileWidth, tileHeight);
  const count = columns * rows;
  const tiles = Array.from({ length: count }, (_, i) => tileset.tiles[i] ?? NEW_TILE);
  if (
    columns === tileset.columns &&
    tileWidth === tileset.tileWidth &&
    tileHeight === tileset.tileHeight &&
    count === tileset.tiles.length
  ) {
    return tileset;
  }
  return { ...tileset, tileWidth, tileHeight, columns, tiles };
}

/** Does the tileset's grid match the image (same columns and tile count)? */
export function fitsImage(tileset: Tileset, imageWidth: number, imageHeight: number): boolean {
  return fitTileset(tileset, imageWidth, imageHeight) === tileset;
}

function changeTiles(
  tileset: Tileset,
  indices: Iterable<number>,
  change: (tile: Tile) => Tile,
): Tileset {
  let tiles: Tile[] | null = null;
  for (const i of indices) {
    const tile = (tiles ?? tileset.tiles)[i];
    if (!tile) continue;
    const next = change(tile);
    if (next === tile) continue;
    tiles ??= [...tileset.tiles];
    tiles[i] = next;
  }
  return tiles ? { ...tileset, tiles } : tileset;
}

/** Set walkability on tiles. Unchanged tiles stay the same objects (no-op edits vanish). */
export function setPassable(
  tileset: Tileset,
  indices: Iterable<number>,
  passable: boolean,
): Tileset {
  return changeTiles(tileset, indices, (t) => (t.passable === passable ? t : { ...t, passable }));
}

/** Mark tiles as drawn above characters, or not (`above` is left out when false). */
export function setAbove(tileset: Tileset, indices: Iterable<number>, above: boolean): Tileset {
  return changeTiles(tileset, indices, (t) => {
    if ((t.above ?? false) === above) return t;
    if (above) return { ...t, above: true };
    const { above: _, ...rest } = t;
    return rest;
  });
}

/** Name a tile (shown in the palette); an empty name removes it. */
export function setTileName(tileset: Tileset, index: number, name: string): Tileset {
  const trimmed = name.trim();
  return changeTiles(tileset, [index], (t) => {
    if ((t.name ?? '') === trimmed) return t;
    if (trimmed) return { ...t, name: trimmed };
    const { name: _, ...rest } = t;
    return rest;
  });
}

/** Maps drawn with a tileset (for warnings and to refuse deleting it). */
export function tilesetUsages(project: OpenedProject, id: string): string[] {
  return [...project.maps.values()]
    .filter((m) => m.data?.tileset === id)
    .map((m) => m.data?.name || m.id);
}

export interface NewTilesetOptions {
  readonly name: string;
  readonly image: string;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly tileWidth: number;
  readonly tileHeight: number;
}

/** A free tileset id from the name, whose file path is free too. */
export function nextTilesetId(doc: ProjectDocument, name: string): string {
  const taken = new Set(doc.project.manifest.data.tilesets.map((t) => t.id));
  const base = idFromName(name, 'tileset');
  for (let n = 1; ; n++) {
    const id = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(id) && !doc.file(tilesetPath(id))) return id;
  }
}

/** Add a tileset cut from an image (every tile walkable). Returns its id. */
export function createTileset(doc: ProjectDocument, options: NewTilesetOptions): string {
  const name = options.name.trim();
  if (!name) throw new Error('Give the tileset a name');
  for (const n of [options.tileWidth, options.tileHeight]) {
    if (!Number.isInteger(n) || n < 1) throw new Error('Tile sizes must be whole numbers above 0');
  }
  if (options.tileWidth > options.imageWidth || options.tileHeight > options.imageHeight) {
    throw new Error('The tiles are bigger than the image');
  }
  const id = nextTilesetId(doc, name);
  const blank: Tileset = {
    formatVersion: TILESET_FORMAT_VERSION,
    id,
    name,
    image: options.image,
    tileWidth: options.tileWidth,
    tileHeight: options.tileHeight,
    columns: 1,
    tiles: [NEW_TILE],
  };
  const tileset = fitTileset(blank, options.imageWidth, options.imageHeight);
  const path = tilesetPath(id);
  doc.edit('New tileset', (tx) => {
    tx.create(path, 'tileset', id, tileset);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      tilesets: [...m.tilesets, { id, path }],
    }));
  });
  return id;
}

/** Remove a tileset no map uses (its file is deleted on save). */
export function deleteTileset(doc: ProjectDocument, id: string): void {
  const users = tilesetUsages(doc.project, id);
  if (users.length > 0) {
    throw new Error(`Maps still use this tileset: ${users.join(', ')}`);
  }
  const entry = doc.project.manifest.data.tilesets.find((t) => t.id === id);
  if (!entry) throw new Error(`Unknown tileset "${id}"`);
  doc.edit('Delete tileset', (tx) => {
    tx.remove(entry.path);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      tilesets: m.tilesets.filter((t) => t.id !== id),
    }));
  });
}
