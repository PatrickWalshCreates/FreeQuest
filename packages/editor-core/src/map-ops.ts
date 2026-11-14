// Project-level map operations: create, duplicate, delete, resize. Each is
// one undo step that keeps project.json and every reference consistent.
import {
  type Command,
  EMPTY_TILE,
  type GameMap,
  MAP_FORMAT_VERSION,
  type Manifest,
  type MapEvent,
  mapCommands,
} from '@freequest/schema';
import type { ProjectDocument } from './document.js';
import { MANIFEST_PATH, type OpenedProject } from './open-project.js';
import { referencesTo } from './usages.js';

/** Where new map files go. */
export const MAP_DIR = 'data/maps';

/** Largest width or height the editor offers (maps are one sprite per cell for now). */
/** Maps are drawn in chunks near the view (M12), so this is about memory for the data, not drawing. */
export const MAX_MAP_SIZE = 512;

export class MapOperationError extends Error {
  override name = 'MapOperationError';
}

export interface NewMapOptions {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly tileset: string;
  /** Tile for the whole ground layer (default 0, the tileset's first tile). */
  readonly fillTile?: number;
}

function checkSize(width: number, height: number): void {
  for (const [label, n] of [
    ['width', width],
    ['height', height],
  ] as const) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_MAP_SIZE) {
      throw new MapOperationError(`Map ${label} must be a whole number from 1 to ${MAX_MAP_SIZE}`);
    }
  }
}

/** The first free id of the form map001, map002, … whose file path is free too. */
export function nextMapId(doc: ProjectDocument): string {
  const manifest = manifestOf(doc);
  const taken = new Set(manifest.maps.map((m) => m.id));
  for (let n = 1; ; n++) {
    const id = `map${String(n).padStart(3, '0')}`;
    if (!taken.has(id) && !doc.file(mapPath(id))) return id;
  }
}

export function mapPath(id: string): string {
  return `${MAP_DIR}/${id}.json`;
}

function manifestOf(doc: ProjectDocument): Manifest {
  return doc.project.manifest.data;
}

/** A fresh map: a ground layer filled with one tile, and an empty layer above it. */
export function newMapData(id: string, options: NewMapOptions): GameMap {
  checkSize(options.width, options.height);
  const row = (tile: number) => Array.from({ length: options.width }, () => tile);
  return {
    formatVersion: MAP_FORMAT_VERSION,
    id,
    name: options.name,
    width: options.width,
    height: options.height,
    tileset: options.tileset,
    layers: [
      {
        name: 'ground',
        data: Array.from({ length: options.height }, () => row(options.fillTile ?? 0)),
      },
      { name: 'upper', data: Array.from({ length: options.height }, () => row(EMPTY_TILE)) },
    ],
    events: [],
  };
}

function addMap(doc: ProjectDocument, label: string, map: GameMap): string {
  const path = mapPath(map.id);
  doc.edit(label, (tx) => {
    tx.create(path, 'map', map.id, map);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      maps: [...m.maps, { id: map.id, path }],
    }));
  });
  return map.id;
}

/** Add a new map to the project. Returns its id. */
export function createMap(doc: ProjectDocument, options: NewMapOptions): string {
  if (!doc.project.tilesets.has(options.tileset)) {
    throw new MapOperationError(`Unknown tileset "${options.tileset}"`);
  }
  return addMap(doc, 'New map', newMapData(nextMapId(doc), options));
}

/** Copy a map (tiles, events, settings) under a new id. Returns the new id. */
export function duplicateMap(doc: ProjectDocument, id: string): string {
  const source = mapData(doc.project, id);
  const copy: GameMap = { ...source, id: nextMapId(doc), name: `${source.name} (copy)` };
  return addMap(doc, 'Duplicate map', copy);
}

function mapData(project: OpenedProject, id: string): GameMap {
  const data = project.maps.get(id)?.data;
  if (!data) throw new MapOperationError(`Map "${id}" isn't loaded`);
  return data;
}

/** Where a map is used by other maps and the rest of the project (its own transfers don't count). */
export function mapUsages(project: OpenedProject, id: string): string[] {
  const own = project.maps.get(id)?.path;
  return [
    ...new Set(
      referencesTo(project, 'map', id)
        .filter((r) => r.file !== own)
        .map((r) => r.where),
    ),
  ];
}

/**
 * Remove a map from the project (its file is deleted on save). The start
 * map can't be deleted. Transfers to it elsewhere are left for the problems
 * panel to report: check `mapUsages` first.
 */
export function deleteMap(doc: ProjectDocument, id: string): void {
  const manifest = manifestOf(doc);
  if (manifest.start.map === id) {
    throw new MapOperationError('The start map can’t be deleted. Choose another start map first.');
  }
  const ref = manifest.maps.find((m) => m.id === id);
  if (!ref) throw new MapOperationError(`Map "${id}" is not part of this project`);
  doc.edit('Delete map', (tx) => {
    tx.remove(ref.path);
    tx.update(MANIFEST_PATH, 'manifest', (m) => ({
      ...m,
      maps: m.maps.filter((r) => r.id !== id),
    }));
  });
}

/** Which edge or corner stays put when resizing: 0 = left/top, 0.5 = center, 1 = right/bottom. */
export interface Anchor {
  readonly x: 0 | 0.5 | 1;
  readonly y: 0 | 0.5 | 1;
}

export interface Resized {
  readonly map: GameMap;
  /** How far existing content moved. */
  readonly dx: number;
  readonly dy: number;
  /** Events that would end up outside the new size (removed). */
  readonly droppedEvents: readonly MapEvent[];
}

/**
 * A map at a new size. New cells on the bottom layer repeat the nearest
 * edge tile, so a meadow grows as meadow; upper layers get empty cells.
 */
export function resizeMap(map: GameMap, width: number, height: number, anchor: Anchor): Resized {
  checkSize(width, height);
  const dx = Math.round((width - map.width) * anchor.x);
  const dy = Math.round((height - map.height) * anchor.y);
  const clamp = (n: number, max: number) => Math.min(Math.max(n, 0), max - 1);
  const layers = map.layers.map((layer, index) => ({
    ...layer,
    data: Array.from({ length: height }, (_, y) =>
      Array.from({ length: width }, (_, x) => {
        const ox = x - dx;
        const oy = y - dy;
        const inside = ox >= 0 && oy >= 0 && ox < map.width && oy < map.height;
        if (inside) return layer.data[oy]?.[ox] ?? EMPTY_TILE;
        return index === 0
          ? (layer.data[clamp(oy, map.height)]?.[clamp(ox, map.width)] ?? EMPTY_TILE)
          : EMPTY_TILE;
      }),
    ),
  }));
  const moved = map.events.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
  const fits = (e: MapEvent) => e.x >= 0 && e.y >= 0 && e.x < width && e.y < height;
  const droppedEvents = map.events.filter((_, i) => {
    const e = moved[i];
    return !e || !fits(e);
  });
  return {
    map: { ...map, width, height, layers, events: moved.filter(fits) },
    dx,
    dy,
    droppedEvents,
  };
}

/** Rewrite every page's commands of every event on a map (identity kept when unchanged). */
function mapEventCommands(map: GameMap, change: (command: Command) => Command): GameMap {
  let changed = false;
  const events = map.events.map((event) => {
    const pages = event.pages.map((page) => {
      const commands = mapCommands(page.commands, change);
      return commands === page.commands ? page : { ...page, commands };
    });
    if (pages.every((p, i) => p === event.pages[i])) return event;
    changed = true;
    return { ...event, pages };
  });
  return changed ? { ...map, events } : map;
}

/**
 * Resize a map as one undo step. When content moves (anchoring right,
 * bottom or center), transfers into this map from any map and the start
 * position move with it, so doors keep leading to the same spot.
 */
export function applyResize(
  doc: ProjectDocument,
  id: string,
  width: number,
  height: number,
  anchor: Anchor,
): Resized {
  const project = doc.project;
  const result = resizeMap(mapData(project, id), width, height, anchor);
  const { dx, dy } = result;
  const shift = (command: Command): Command =>
    command.type === 'transfer' && command.map === id
      ? { ...command, x: command.x + dx, y: command.y + dy }
      : command;
  doc.edit('Resize map', (tx) => {
    for (const [mapId, file] of project.maps) {
      if (!file.data) continue;
      tx.update(file.path, 'map', (map) => {
        const base = mapId === id ? result.map : map;
        return dx === 0 && dy === 0 ? base : mapEventCommands(base, shift);
      });
    }
    if (dx !== 0 || dy !== 0) {
      tx.update(MANIFEST_PATH, 'manifest', (m) =>
        m.start.map === id
          ? { ...m, start: { ...m.start, x: m.start.x + dx, y: m.start.y + dy } }
          : m,
      );
    }
  });
  return result;
}
