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

/**
 * Draws MZ tiles of one tileset: loads its sheets on first use (missing ones
 * are reported once and leave their tiles blank).
 */
export class TileDrawer {
  readonly #sheets = new Map<SheetName, RgbaImage | null>();
  /** Whether a drawn tile animates in MZ (only its first frame is drawn). */
  animated = false;

  constructor(
    readonly mz: MzTileset,
    readonly tileSize: number,
    private readonly fs: ProjectFs,
    private readonly codec: ImageCodec,
    private readonly report: ImportReport,
  ) {}

  async #sheet(name: SheetName): Promise<RgbaImage | null> {
    if (this.#sheets.has(name)) return this.#sheets.get(name) ?? null;
    const where = `Tilesets › ${this.mz.name}`;
    const file = this.mz.sheets[name];
    let decoded: RgbaImage | null = null;
    if (file === '') {
      this.report.missing(
        where,
        `Its maps use ${name} tiles, but it has no ${name} image; they're left blank.`,
      );
    } else {
      const path = `img/tilesets/${file}.png`;
      try {
        decoded = await this.codec.decode(await this.fs.readBytes(path));
      } catch (error) {
        this.report.missing(
          where,
          error instanceof FileNotFoundError
            ? `${path} is missing, so its ${name} tiles are left blank.`
            : `${path} couldn't be read as a PNG, so its ${name} tiles are left blank.`,
        );
      }
    }
    this.#sheets.set(name, decoded);
    return decoded;
  }

  /** Draw MZ tile `mzId` into `image` with its top left at (x, y). */
  async draw(mzId: number, image: RgbaImage, x: number, y: number): Promise<void> {
    const size = this.tileSize;
    const quarter = size / 2;
    const source = tileSource(mzId);
    if (!source) return;
    const src = await this.#sheet(source.sheet);
    if (!src) return;
    if (source.kind === 'tile') {
      copyArea(src, source.col * size, source.row * size, size, size, image, x, y);
      return;
    }
    this.animated ||= source.animated;
    for (const p of source.pieces) {
      copyArea(
        src,
        p.sx * quarter,
        p.sy * quarter,
        quarter,
        quarter,
        image,
        x + p.dx * quarter,
        y + p.dy * quarter,
      );
    }
  }
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
    readonly drawer: TileDrawer,
  ) {}

  get tileSize(): number {
    return this.drawer.tileSize;
  }

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
    codec: ImageCodec,
    report: ImportReport,
  ): Promise<{ tileset: Tileset; image: Uint8Array }> {
    const size = this.tileSize;
    const count = Math.max(1, this.#variants.length);
    const columns = Math.min(count, Math.max(8, Math.ceil(Math.sqrt(count))));
    const image = blankImage(columns * size, Math.ceil(count / columns) * size);
    const tiles: Tileset['tiles'] = [];
    for (const [i, variant] of this.#variants.entries()) {
      await this.drawer.draw(
        variant.mzId,
        image,
        (i % columns) * size,
        Math.floor(i / columns) * size,
      );
      tiles.push({ passable: variant.passable, ...(variant.above ? { above: true } : {}) });
    }
    if (tiles.length === 0) tiles.push({ passable: false });
    if (this.drawer.animated) {
      report.changed(
        `Tilesets › ${this.mz.name}`,
        'Its water moved; FreeQuest tiles are still, so water shows its first frame.',
      );
    }
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
