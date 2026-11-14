// Every map the MZ project lists, with the tilesets they use baked as they go.
import type { ProjectFs } from '@freequest/editor-core';
import type { GameMap, Manifest, Tileset } from '@freequest/schema';
import { NumberedIds } from './ids.js';
import type { ImageCodec } from './image.js';
import { asInt, isRecord, type JsonRecord } from './json.js';
import { convertMap, displayName, mapWhere } from './maps.js';
import type { MzDatabase } from './mz-lists.js';
import { type MzProject, readMzJson } from './mz-project.js';
import type { ImportReport } from './report.js';
import { TileDrawer, TilesetBaker, readMzTilesets } from './tilesets.js';

export interface ImportedMaps {
  readonly maps: {
    readonly path: string;
    data: GameMap;
    /** MZ's map, for its events. */
    readonly raw: JsonRecord;
    readonly where: string;
    readonly drawer: TileDrawer;
    readonly mzId: number;
  }[];
  readonly tilesets: { readonly path: string; readonly data: Tileset }[];
  readonly images: { readonly path: string; readonly bytes: Uint8Array }[];
  /** The player's start, when the start map was imported. */
  readonly start: Manifest['start'] | null;
}

/** MZ's map file for map number `n`: data/Map007.json. */
export const mapFile = (n: number) => `data/Map${String(n).padStart(3, '0')}.json`;

export async function importMaps(
  fs: ProjectFs,
  mz: MzProject,
  db: MzDatabase,
  report: ImportReport,
  codec: ImageCodec,
): Promise<ImportedMaps> {
  const tilesets = readMzTilesets(await readMzJson(fs, 'data/Tilesets.json'));
  const tilesetNames = [''];
  for (const [n, t] of tilesets) tilesetNames[n] = t.name;
  const tilesetIds = new NumberedIds(
    Array.from(tilesetNames, (name) => name ?? ''),
    'tileset',
    new Set(),
  );
  const mapNames = [''];
  for (const info of mz.maps) mapNames[info.id] = info.name;
  const mapIds = new NumberedIds(
    Array.from(mapNames, (name) => name ?? ''),
    'map',
    new Set(),
  );

  const bakers = new Map<number, TilesetBaker>();
  const baker = (n: number) => {
    const known = bakers.get(n);
    if (known) return known;
    const tileset = tilesets.get(n);
    if (!tileset) return null;
    const drawer = new TileDrawer(tileset, mz.system.tileSize, fs, codec, report);
    const made = new TilesetBaker(tileset, tilesetIds.id(n), drawer);
    bakers.set(n, made);
    return made;
  };

  const maps: ImportedMaps['maps'] = [];
  let named = 0;
  for (const info of mz.maps) {
    const raw = await readMzJson(fs, mapFile(info.id));
    if (!isRecord(raw)) {
      report.missing(mapWhere(info), `${mapFile(info.id)} is missing, so the map was left out.`);
      continue;
    }
    if (displayName(raw)) named++;
    const id = mapIds.id(info.id);
    const map = convertMap(raw, info, id, { report, troops: db.troops, baker });
    const drawer = bakers.get(asInt(raw['tilesetId']))?.drawer;
    if (map && drawer) {
      maps.push({
        path: `data/maps/${id}.json`,
        data: map,
        raw,
        where: mapWhere(info),
        drawer,
        mzId: info.id,
      });
    }
  }
  if (named > 0) {
    report.note(
      'Maps',
      `${named} ${named === 1 ? 'map shows its name' : 'maps show their names'} on arrival in MZ; FreeQuest doesn't show map names.`,
    );
  }

  const baked: ImportedMaps['tilesets'] = [];
  const images: ImportedMaps['images'] = [];
  for (const b of [...bakers.values()].sort((x, y) => x.mz.n - y.mz.n)) {
    const { tileset, image } = await b.bake(codec, report);
    baked.push({ path: `data/tilesets/${tileset.id}.json`, data: tileset });
    images.push({ path: tileset.image, bytes: image });
  }

  const { start } = mz.system;
  const startMap = maps.find(
    (m) => m.data.id === (mz.maps.some((i) => i.id === start.map) ? mapIds.id(start.map) : null),
  );
  let place: Manifest['start'] | null = null;
  if (startMap) {
    place = {
      map: startMap.data.id,
      x: Math.min(start.x, startMap.data.width - 1),
      y: Math.min(start.y, startMap.data.height - 1),
      direction: 'down',
      party: [],
      gold: 0,
    };
  } else if (maps[0]) {
    report.changed('Project', 'The start map wasn’t imported; the game starts on the first map.');
    place = { map: maps[0].data.id, x: 0, y: 0, direction: 'down', party: [], gold: 0 };
  }
  return { maps, tilesets: baked, images, start: place };
}
