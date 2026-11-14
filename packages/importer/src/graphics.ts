// Characters, faces, enemy images and icons from an MZ project's img/ folder.
// Only the pictures something uses are brought across:
//  - an MZ character sheet holds 8 characters (4 × 2 blocks of 3 frames × 4
//    directions), or one when its name has "$"; each used character becomes
//    its own FreeQuest sheet (same frame layout: down, left, right, up);
//  - an MZ face sheet is a 4 × 2 grid; FreeQuest's is one row of square faces,
//    so the faces are laid out in a row and keep their numbers;
//  - enemy images and the icon sheet are copied as they are.
import { FileNotFoundError, type ProjectFs, uniqueId } from '@freequest/editor-core';
import { CHARACTER_FORMAT_VERSION, type CharacterSheet, idFromName } from '@freequest/schema';
import { type ImageCodec, type RgbaImage, blankImage, copyArea } from './image.js';
import type { ImportReport } from './report.js';

/** MZ's icon size; its icon sheet is 16 icons wide. */
export const MZ_ICON_SIZE = 32;

export interface ImportedGraphics {
  readonly characters: { readonly path: string; readonly data: CharacterSheet }[];
  readonly files: { readonly path: string; readonly bytes: Uint8Array }[];
  readonly iconset: {
    readonly image: string;
    readonly iconSize: number;
    readonly columns: number;
  } | null;
}

export class GraphicsImporter {
  readonly #images = new Map<string, RgbaImage | null>();
  readonly #characters = new Map<string, string | null>();
  readonly #faces = new Map<string, string | null>();
  readonly #enemies = new Map<string, string | null>();
  readonly #characterIds = new Set<string>();
  readonly #faceIds = new Set<string>();
  readonly #enemyIds = new Set<string>();
  readonly #out: {
    characters: ImportedGraphics['characters'][number][];
    files: ImportedGraphics['files'][number][];
  } = { characters: [], files: [] };

  constructor(
    private readonly fs: ProjectFs,
    private readonly codec: ImageCodec,
    private readonly report: ImportReport,
    /** Side-view battles: enemy images are looked for in img/sv_enemies first. */
    private readonly sideView = false,
  ) {}

  /** Read and decode an image once; null (reported) when missing or unreadable. */
  async #image(path: string, where: string): Promise<RgbaImage | null> {
    if (this.#images.has(path)) return this.#images.get(path) ?? null;
    let image: RgbaImage | null = null;
    try {
      image = await this.codec.decode(await this.fs.readBytes(path));
    } catch (error) {
      this.report.missing(
        where,
        error instanceof FileNotFoundError
          ? await this.#missing(path)
          : `${path} couldn't be read as a PNG.`,
      );
    }
    this.#images.set(path, image);
    return image;
  }

  /**
   * The FreeQuest character for MZ character `index` on sheet `name`, made on
   * first use. Null when there's no such picture (reported).
   */
  async character(name: string, index: number, where: string): Promise<string | null> {
    if (name === '') return null;
    const single = /^[!$]*\$/.test(name);
    const key = single ? name : `${name}#${index}`;
    if (this.#characters.has(key)) return this.#characters.get(key) ?? null;
    this.#characters.set(key, null);
    const sheet = await this.#image(`img/characters/${name}.png`, where);
    if (!sheet) return null;
    const frameWidth = Math.floor(sheet.width / (single ? 3 : 12));
    const frameHeight = Math.floor(sheet.height / (single ? 4 : 8));
    if (frameWidth === 0 || frameHeight === 0) {
      this.report.missing(where, `img/characters/${name}.png is too small to hold characters.`);
      return null;
    }
    const block = blankImage(frameWidth * 3, frameHeight * 4);
    const i = single ? 0 : Math.max(0, Math.min(7, index));
    copyArea(
      sheet,
      (i % 4) * frameWidth * 3,
      Math.floor(i / 4) * frameHeight * 4,
      block.width,
      block.height,
      block,
      0,
      0,
    );

    const base = idFromName(name.replace(/^[!$]+/, ''), 'character');
    const id = uniqueId(single ? base : `${base}-${i + 1}`, this.#characterIds);
    this.#characterIds.add(id);
    const image = `assets/characters/${id}.png`;
    this.#out.files.push({ path: image, bytes: await this.codec.encode(block) });
    this.#out.characters.push({
      path: `data/characters/${id}.json`,
      data: {
        formatVersion: CHARACTER_FORMAT_VERSION,
        id,
        name: single ? name.replace(/^[!$]+/, '') : `${name.replace(/^[!$]+/, '')} ${i + 1}`,
        image,
        frameWidth,
        frameHeight,
        frames: 3,
        rows: ['down', 'left', 'right', 'up'],
        idleFrame: 1,
        walkCycle: [0, 1, 2, 1],
      },
    });
    this.#characters.set(key, id);
    return id;
  }

  /** A message face: the face sheet made from MZ's `name` and the face's number on it. */
  async face(
    name: string,
    index: number,
    where: string,
  ): Promise<{ image: string; index: number } | null> {
    if (name === '') return null;
    if (!this.#faces.has(name)) {
      this.#faces.set(name, null);
      const sheet = await this.#image(`img/faces/${name}.png`, where);
      if (sheet) {
        const size = Math.floor(Math.min(sheet.width / 4, sheet.height / 2));
        if (size > 0) {
          const row = blankImage(size * 8, size);
          for (let n = 0; n < 8; n++) {
            copyArea(sheet, (n % 4) * size, Math.floor(n / 4) * size, size, size, row, n * size, 0);
          }
          const id = uniqueId(idFromName(name, 'face'), this.#faceIds);
          this.#faceIds.add(id);
          const path = `assets/faces/${id}.png`;
          this.#out.files.push({ path, bytes: await this.codec.encode(row) });
          this.#faces.set(name, path);
        }
      }
    }
    const image = this.#faces.get(name);
    return image ? { image, index: Math.max(0, Math.min(7, index)) } : null;
  }

  /**
   * An enemy's battle image, copied as it is. Side-view games keep them in
   * img/sv_enemies, others in img/enemies; both are tried, that one first.
   * Null when there's none (reported).
   */
  async enemy(name: string, where: string): Promise<string | null> {
    if (name === '') return null;
    if (this.#enemies.has(name)) return this.#enemies.get(name) ?? null;
    const folders = this.sideView ? ['sv_enemies', 'enemies'] : ['enemies', 'sv_enemies'];
    let path: string | null = null;
    for (const folder of folders) {
      try {
        const bytes = await this.fs.readBytes(`img/${folder}/${name}.png`);
        const id = uniqueId(idFromName(name, 'enemy'), this.#enemyIds);
        this.#enemyIds.add(id);
        path = `assets/enemies/${id}.png`;
        this.#out.files.push({ path, bytes });
        break;
      } catch (error) {
        if (!(error instanceof FileNotFoundError)) throw error;
      }
    }
    if (!path) this.report.missing(where, await this.#missing(`img/${folders[0]}/${name}.png`));
    this.#enemies.set(name, path);
    return path;
  }

  /** Why a picture is missing: encrypted, or not there. */
  async #missing(path: string): Promise<string> {
    try {
      await this.fs.readBytes(`${path}_`);
      return `${path} is encrypted (MZ does that when deploying a game); import the project folder from MZ's editor instead.`;
    } catch {
      return `${path} is missing.`;
    }
  }

  /** Everything made, plus the icon sheet when the project has one. */
  async finish(): Promise<ImportedGraphics> {
    let iconset: ImportedGraphics['iconset'] = null;
    const from = 'img/system/IconSet.png';
    try {
      const bytes = await this.fs.readBytes(from);
      const sheet = await this.codec.decode(bytes);
      const image = 'assets/system/iconset.png';
      this.#out.files.push({ path: image, bytes });
      iconset = {
        image,
        iconSize: MZ_ICON_SIZE,
        columns: Math.max(1, Math.floor(sheet.width / MZ_ICON_SIZE)),
      };
    } catch (error) {
      this.report.missing(
        'Icons',
        error instanceof FileNotFoundError
          ? await this.#missing(from)
          : `${from} couldn't be read as a PNG.`,
      );
    }
    return { ...this.#out, iconset };
  }
}
