// MZ's animations are Effekseer effects (particles, models), which FreeQuest
// can't play and the importer can't turn into frames. Each one something uses
// (an event, a skill, an item) becomes a stand-in entry: its name, about its
// length, and its sounds at their times, with no image for the author to
// draw. Only used ones come across (games define hundreds).
import type { AnimationEntry } from '@freequest/schema';
import type { AudioImporter } from './audio.js';
import { asArray, asInt, asRecord, asString } from './json.js';
import type { MzList } from './mz-lists.js';
import type { ImportReport } from './report.js';

/** Frames per second of the stand-ins (MZ times sounds in 1/60 s; this halves them). */
const STAND_IN_FPS = 30;
/** The shortest stand-in, in seconds (an effect with no timings still takes a moment). */
const MIN_SECONDS = 0.5;

export class AnimationImporter {
  readonly #used = new Map<number, string>();

  constructor(private readonly list: MzList) {}

  /** The id of animation `n` (marking it used), or null if there's no such animation. */
  use(n: number): string | null {
    const id = this.list.id(n);
    if (id) this.#used.set(n, id);
    return id;
  }

  /** Stand-ins for every used animation, in number order, with their sounds. */
  async finish(audio: AudioImporter, report: ImportReport): Promise<AnimationEntry[]> {
    const entries: AnimationEntry[] = [];
    let flashes = 0;
    for (const { n, id, name, entry } of this.list) {
      if (!this.#used.has(n)) continue;
      const where = `Animations › ${name}`;
      const speed = Math.max(1, asInt(entry['speed'], 100)) / 100;
      const timings = asArray(entry['soundTimings']).map(asRecord);
      const flashTimings = asArray(entry['flashTimings']).map(asRecord);
      if (flashTimings.length > 0) flashes++;
      // The last thing it times, in MZ's 1/60 s frames (stretched by its speed).
      const last = Math.max(
        0,
        ...timings.map((t) => asInt(t['frame'])),
        ...flashTimings.map((t) => asInt(t['frame']) + asInt(t['duration'])),
      );
      const seconds = Math.max(MIN_SECONDS, last / 60 / speed + 0.2);
      const sounds: AnimationEntry['sounds'] = [];
      for (const t of timings) {
        const path = await audio.sound('se', asString(asRecord(t['se'])['name']).trim(), where);
        if (!path) continue;
        const frame = Math.round((asInt(t['frame']) / 60 / speed) * STAND_IN_FPS);
        sounds.push({ frame, path });
      }
      const effect = asString(entry['effectName']).trim();
      entries.push({
        id,
        name,
        frameWidth: 32,
        frameHeight: 32,
        frames: Math.max(1, Math.round(seconds * STAND_IN_FPS)),
        fps: STAND_IN_FPS,
        sounds,
        note: `From MZ${effect ? ` (the effect “${effect}”)` : ''}: a stand-in with its length and sounds. Choose an image of frames to draw it.`,
      });
    }
    if (entries.length > 0) {
      report.changed(
        'Animations',
        `${entries.length} ${entries.length === 1 ? 'animation is a stand-in' : 'animations are stand-ins'}: MZ's are Effekseer effects, which FreeQuest can't play. Each keeps its name, length and sounds; give it frames in Database › Animations.`,
        [{ name: 'Animations to draw', count: entries.length }],
      );
    }
    if (flashes > 0) {
      report.missing(
        'Animations',
        `${flashes} of them flashed the screen or the target; the stand-ins don't.`,
        [{ name: 'Animation flashes', count: flashes }],
      );
    }
    return entries;
  }
}

/** MZ's balloon icons (rows of Balloon.png), in our words. */
export const MZ_BALLOON_NAMES = [
  'Surprise',
  'Question',
  'Music',
  'Heart',
  'Anger',
  'Sweat',
  'Frustration',
  'Silence',
  'Idea',
  'Sleep',
  'Custom 1',
  'Custom 2',
  'Custom 3',
  'Custom 4',
  'Custom 5',
];
