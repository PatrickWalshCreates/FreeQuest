// MZ tilesets as FreeQuest tilesets. An MZ tileset is nine sheets and a flag
// per tile number; a FreeQuest tileset is one image cut into a grid with
// walkable/above flags per tile. Each MZ tileset becomes one generated image
// holding exactly the tiles its maps use (autotiles baked into plain tiles),
// so nothing unused is copied.
import { FileNotFoundError, type ProjectFs } from '@freequest/editor-core';
import { TILESET_FORMAT_VERSION, type Tileset } from '@freequest/schema';
import { type ImageCodec, type RgbaImage, blankImage, copyArea } from './image.js';
import { asArray, asInt, asString, isRecord } from './json.js';
import type { ImportReport } from './report.js';
import { SHEETS, type SheetName, tileSource } from './tiles.js';

/** MZ tile flag bits. */
export const TILE_FLAGS = {
  /** All four directions blocked (bits 0–3, one per direction). */
  blocked: 0x0f,
  /** Drawn above characters; ignored for passage ("star"). */
  above: 0x10,
  counter: 0x80,
  damage: 0x100,
} as const;

export interface MzTileset {
  readonly n: number;
  readonly name: string;
  /** Image names by sheet ('' when the sheet isn't used). */
  readonly sheets: Readonly<Record<SheetName, string>>;
  readonly flags: readonly number[];
}

export function readMzTilesets(raw: unknown): Map<number, MzTileset> {
  const tilesets = new Map<number, MzTileset>();
  asArray(raw).forEach((entry, n) => {
    if (n === 0 || !isRecord(entry)) return;
    const names = asArray(entry['tilesetNames']);
    const sheets = Object.fromEntries(
      SHEETS.map((sheet, i) => [sheet, asString(names[i]).trim()]),
    ) as Record<SheetName, string>;
    tilesets.set(n, {
      n,
      name: asString(entry['name']).trim() || `Tileset ${n}`,
      sheets,
      flags: asArray(entry['flags']).map((f) => asInt(f)),
    });
  });
  return tilesets;
}

interface Variant {
  readonly mzId: number;
  readonly passable: boolean;
  readonly above: boolean;
}

/** Collects the tiles a tileset's maps use, then draws them into one image. */
export class TilesetBaker {
  readonly #index = new Map<string, number>();
  readonly #variants: Variant[] = [];

  constructor(
    readonly mz: MzTileset,
    readonly id: string,
    readonly tileSize: number,
  ) {}

  flag(mzId: number): number {
    return this.mz.flags[mzId] ?? 0;
  }

  /** Whether the tile is drawn above characters (and ignored for passage). */
  isAbove(mzId: number): boolean {
    return (this.flag(mzId) & TILE_FLAGS.above) !== 0;
  }

  /** Whether some direction is open: FreeQuest's walkable is one flag for all four. */
  isPassable(mzId: number): boolean {
    return (this.flag(mzId) & TILE_FLAGS.blocked) !== TILE_FLAGS.blocked;
  }

  /** The FreeQuest tile index for an MZ tile with these flags (added on first use). */
  tile(mzId: number, passable: boolean, above: boolean): number {
    const key = `${mzId}|${passable ? 1 : 0}|${above ? 1 : 0}`;
    const known = this.#index.get(key);
    if (known !== undefined) return known;
    const index = this.#variants.length;
    this.#variants.push({ mzId, passable, above });
    this.#index.set(key, index);
    return index;
  }

  get used(): number {
    return this.#variants.length;
  }

  /** Draw every used tile and describe the tileset. */
  async bake(
    fs: ProjectFs,
    codec: ImageCodec,
    report: ImportReport,
  ): Promise<{ tileset: Tileset; image: Uint8Array }> {
    const size = this.tileSize;
    const quarter = size / 2;
    const count = Math.max(1, this.#variants.length);
    const columns = Math.min(count, Math.max(8, Math.ceil(Math.sqrt(count))));
    const image = blankImage(columns * size, Math.ceil(count / columns) * size);
    const sheets = new Map<SheetName, RgbaImage | null>();
    const where = `Tilesets › ${this.mz.name}`;
    let animated = false;

    const sheet = async (name: SheetName): Promise<RgbaImage | null> => {
      if (sheets.has(name)) return sheets.get(name) ?? null;
      const file = this.mz.sheets[name];
      let decoded: RgbaImage | null = null;
      if (file === '') {
        report.missing(
          where,
          `Its maps use ${name} tiles, but it has no ${name} image; they're left blank.`,
        );
      } else {
        const path = `img/tilesets/${file}.png`;
        try {
          decoded = await codec.decode(await fs.readBytes(path));
        } catch (error) {
          report.missing(
            where,
            error instanceof FileNotFoundError
              ? `${path} is missing, so its ${name} tiles are left blank.`
              : `${path} couldn't be read as a PNG, so its ${name} tiles are left blank.`,
          );
        }
      }
      sheets.set(name, decoded);
      return decoded;
    };

    const tiles: Tileset['tiles'] = [];
    for (const [i, variant] of this.#variants.entries()) {
      const tx = (i % columns) * size;
      const ty = Math.floor(i / columns) * size;
      const source = tileSource(variant.mzId);
      if (source) {
        const src = await sheet(source.sheet);
        if (src && source.kind === 'tile') {
          copyArea(src, source.col * size, source.row * size, size, size, image, tx, ty);
        } else if (src && source.kind === 'pieces') {
          animated ||= source.animated;
          for (const p of source.pieces) {
            copyArea(
              src,
              p.sx * quarter,
              p.sy * quarter,
              quarter,
              quarter,
              image,
              tx + p.dx * quarter,
              ty + p.dy * quarter,
            );
          }
        }
      }
      tiles.push({ passable: variant.passable, ...(variant.above ? { above: true } : {}) });
    }
    if (tiles.length === 0) tiles.push({ passable: false });
    if (animated)
      report.changed(
        where,
        'Its water moved; FreeQuest tiles are still, so water shows its first frame.',
      );

    return {
      tileset: {
        formatVersion: TILESET_FORMAT_VERSION,
        id: this.id,
        name: this.mz.name,
        image: `assets/tilesets/${this.id}.png`,
        tileWidth: size,
        tileHeight: size,
        columns,
        tiles,
      },
      image: await codec.encode(image),
    };
  }
}
