// Music and sounds from an MZ project's audio/ folder, copied on first use.
// MZ keeps each sound as .ogg (and often .m4a for Apple devices); FreeQuest
// plays .ogg, so that's preferred.
import { FileNotFoundError, type ProjectFs, uniqueId } from '@freequest/editor-core';
import { idFromName } from '@freequest/schema';
import type { ImportReport } from './report.js';

/** MZ's audio folders: music, background sounds, jingles, sound effects. */
export type AudioFolder = 'bgm' | 'bgs' | 'me' | 'se';

export class AudioImporter {
  readonly #paths = new Map<string, string | null>();
  readonly #ids = new Map<AudioFolder, Set<string>>();
  readonly files: { readonly path: string; readonly bytes: Uint8Array }[] = [];

  constructor(
    private readonly fs: ProjectFs,
    private readonly report: ImportReport,
  ) {}

  /** The project path of MZ sound `name` in `folder`, copied on first use; null if it's missing (reported). */
  async sound(folder: AudioFolder, name: string, where: string): Promise<string | null> {
    if (name === '') return null;
    const key = `${folder}/${name}`;
    if (this.#paths.has(key)) return this.#paths.get(key) ?? null;
    let path: string | null = null;
    for (const ext of ['ogg', 'm4a']) {
      try {
        const bytes = await this.fs.readBytes(`audio/${folder}/${name}.${ext}`);
        const taken = this.#ids.get(folder) ?? new Set<string>();
        this.#ids.set(folder, taken);
        const id = uniqueId(idFromName(name, 'sound'), taken);
        taken.add(id);
        path = `assets/audio/${folder}/${id}.${ext}`;
        this.files.push({ path, bytes });
        break;
      } catch (error) {
        if (!(error instanceof FileNotFoundError)) throw error;
      }
    }
    if (!path)
      this.report.missing(where, `audio/${folder}/${name}.ogg is missing, so it's silent.`);
    this.#paths.set(key, path);
    return path;
  }
}
