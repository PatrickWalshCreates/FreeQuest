// MZ maps as FreeQuest maps. MZ stores four tile layers plus shadows and
// regions in one flat array; FreeQuest keeps the tile layers as rows.
//
// Passage: MZ decides a cell by its topmost tile that isn't drawn above
// characters, so a bridge over water is walkable; FreeQuest needs every
// collidable tile on a cell to be walkable. Each tile is therefore baked with
// the walkable flag that gives the cell MZ's answer (a tile can appear twice
// in the tileset, walkable and not).
import {
  EMPTY_TILE,
  type Encounters,
  type GameMap,
  MAP_FORMAT_VERSION,
  type MapLayer,
} from '@freequest/schema';
import { asArray, asInt, asRecord, asString, type JsonRecord } from './json.js';
import type { MzList } from './mz-lists.js';
import type { MzMapInfo } from './mz-project.js';
import type { ImportReport } from './report.js';
import { TILE_FLAGS, type TilesetBaker } from './tilesets.js';

const TILE_LAYERS = 4;
/** MZ's A4 sheet (wall tops and walls). */
const isWallTop = (id: number) => id >= 5888 && id < 8192;
const SHADOW_LAYER = 4;
const REGION_LAYER = 5;
const LAYER_NAMES = ['ground', 'ground 2', 'upper', 'upper 2'];

export interface MapContext {
  readonly report: ImportReport;
  readonly troops: MzList;
  /** The baker for an MZ tileset number (null when the project has no such tileset). */
  baker(n: number): TilesetBaker | null;
}

/** Where the map is, for the report: "Maps › Hollow". */
export const mapWhere = (info: MzMapInfo) => `Maps › ${info.name || `Map ${info.id}`}`;

export function convertMap(
  raw: JsonRecord,
  info: MzMapInfo,
  id: string,
  ctx: MapContext,
): GameMap | null {
  const where = mapWhere(info);
  const width = asInt(raw['width']);
  const height = asInt(raw['height']);
  if (width <= 0 || height <= 0) {
    ctx.report.missing(where, 'Its size is missing, so it was left out.');
    return null;
  }
  const baker = ctx.baker(asInt(raw['tilesetId']));
  if (!baker) {
    ctx.report.missing(where, 'Its tileset is missing, so it was left out.');
    return null;
  }
  const data = asArray(raw['data']).map((v) => asInt(v));
  const at = (x: number, y: number, z: number) => data[(z * height + y) * width + x] ?? 0;

  const layers: number[][][] = Array.from({ length: TILE_LAYERS }, () =>
    Array.from({ length: height }, () => new Array<number>(width).fill(EMPTY_TILE)),
  );
  let partial = 0;
  let shadows = false;
  let regions = false;
  let counters = false;
  let damage = false;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (at(x, y, SHADOW_LAYER) !== 0) shadows = true;
      if (at(x, y, REGION_LAYER) !== 0) regions = true;
      const ids = [0, 1, 2, 3].map((z) => at(x, y, z));
      // MZ's answer: the topmost tile not drawn above characters decides.
      let top = -1;
      for (let z = TILE_LAYERS - 1; z >= 0; z--) {
        const tile = ids[z] ?? 0;
        if (tile > 0 && !baker.isAbove(tile)) {
          top = z;
          break;
        }
      }
      const topId = top >= 0 ? (ids[top] ?? 0) : 0;
      const walkable = top >= 0 && baker.isPassable(topId);
      if (top >= 0) {
        const blocked = baker.flag(topId) & TILE_FLAGS.blocked;
        // A4 wall tops are blocked at their outer edges in MZ, beside walls that
        // block anyway, so walkable is what MZ plays like; other one-way tiles differ.
        if (blocked !== 0 && blocked !== TILE_FLAGS.blocked && !isWallTop(topId)) partial++;
        if (baker.flag(topId) & TILE_FLAGS.counter) counters = true;
        if (baker.flag(topId) & TILE_FLAGS.damage) damage = true;
      }
      ids.forEach((tile, z) => {
        if (tile <= 0) return;
        const above = baker.isAbove(tile);
        const passable = above
          ? baker.isPassable(tile)
          : walkable || (z !== top && baker.isPassable(tile));
        const row = layers[z]?.[y];
        if (row) row[x] = baker.tile(tile, passable, above);
      });
    }
  }

  if (partial > 0) {
    ctx.report.changed(
      where,
      `${partial} ${partial === 1 ? 'tile is' : 'tiles are'} passable from some sides only; FreeQuest tiles are walkable from every side or none, so they're walkable.`,
    );
  }
  if (shadows) ctx.report.missing(where, 'Its wall shadows aren’t drawn.');
  if (counters) ctx.report.missing(where, 'Talking across counters doesn’t work in FreeQuest yet.');
  if (damage) ctx.report.missing(where, 'Its damage floors don’t hurt in FreeQuest.');

  const kept: MapLayer[] = layers
    .map((rows, z) => ({ name: LAYER_NAMES[z] ?? `layer ${z + 1}`, data: rows }))
    .filter((layer, z) => z === 0 || layer.data.some((row) => row.some((t) => t !== EMPTY_TILE)));

  const encounters = mapEncounters(raw, where, ctx);
  if (regions && !encounters)
    ctx.report.note(where, 'It uses regions, which FreeQuest maps don’t have.');
  return {
    formatVersion: MAP_FORMAT_VERSION,
    id,
    name: info.name || `Map ${info.id}`,
    width,
    height,
    tileset: baker.id,
    layers: kept,
    events: [],
    ...(encounters ? { encounters } : {}),
  };
}

function mapEncounters(raw: JsonRecord, where: string, ctx: MapContext): Encounters | null {
  const troops: Encounters['troops'] = [];
  let byRegion = false;
  for (const entry of asArray(raw['encounterList'])) {
    const e = asRecord(entry);
    const troop = ctx.troops.id(asInt(e['troopId']));
    if (!troop) continue;
    if (asArray(e['regionSet']).length > 0) byRegion = true;
    troops.push({ troop, weight: Math.max(1, asInt(e['weight'], 1)) });
  }
  if (troops.length === 0) return null;
  if (byRegion) {
    ctx.report.changed(
      where,
      `Some of its battles happened only in certain regions; now they can happen anywhere on the map.`,
    );
  }
  return { steps: Math.max(1, asInt(raw['encounterStep'], 30)), troops };
}

/** The map's display name, if it has one (FreeQuest doesn't show map names). */
export function displayName(raw: JsonRecord): string {
  return asString(raw['displayName']).trim();
}
