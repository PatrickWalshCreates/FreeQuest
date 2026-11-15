// Pictures events show over the map: numbered images at screen positions,
// with a size and an opacity, moved over time. Core keeps where each one is
// (advanced with the world's fixed steps); the runtime only draws them.
import type { Easing, PictureOrigin } from '@freequest/schema';

/** One picture as it is now (screen pixels, scale as a factor, opacity 0–1). */
export interface Picture {
  readonly number: number;
  readonly image: string;
  readonly origin: PictureOrigin;
  readonly x: number;
  readonly y: number;
  readonly scaleX: number;
  readonly scaleY: number;
  readonly opacity: number;
}

/** Where and how a picture is, without its number and image. */
export type PictureLook = Omit<Picture, 'number' | 'image'>;

const NUMBERS = ['x', 'y', 'scaleX', 'scaleY', 'opacity'] as const;

/** Progress 0..1 through a move, shaped by its easing. */
export function ease(easing: Easing, t: number): number {
  switch (easing) {
    case 'linear':
      return t;
    case 'ease-in':
      return t * t;
    case 'ease-out':
      return 1 - (1 - t) * (1 - t);
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
  }
}

interface Move {
  readonly from: PictureLook;
  readonly to: PictureLook;
  readonly seconds: number;
  readonly easing: Easing;
  elapsed: number;
}

interface Slot {
  picture: Picture;
  move: Move | null;
  /** Bumped by each show and move, so an older move's "finished" check knows it was replaced. */
  generation: number;
}

/** The pictures on screen, by number. */
export class Pictures {
  private readonly slots = new Map<number, Slot>();

  /** Show an image as picture `number` (replacing whatever had that number). */
  show(number: number, image: string, look: PictureLook): void {
    const old = this.slots.get(number);
    this.slots.set(number, {
      picture: { number, image, ...look },
      move: null,
      generation: (old?.generation ?? 0) + 1,
    });
  }

  /**
   * Move picture `number` to `look` over `seconds`. Returns a check that's
   * true once it has arrived (or the picture was replaced, erased, or never
   * there).
   */
  move(number: number, look: PictureLook, seconds: number, easing: Easing): () => boolean {
    const slot = this.slots.get(number);
    if (!slot) return () => true;
    const generation = ++slot.generation;
    if (seconds <= 0) {
      slot.picture = { ...slot.picture, ...look };
      slot.move = null;
    } else {
      slot.move = { from: { ...slot.picture }, to: look, seconds, easing, elapsed: 0 };
    }
    return () => this.slots.get(number) !== slot || slot.generation !== generation || !slot.move;
  }

  erase(number: number): void {
    this.slots.delete(number);
  }

  update(dt: number): void {
    for (const slot of this.slots.values()) {
      const move = slot.move;
      if (!move) continue;
      move.elapsed += dt;
      const done = move.elapsed >= move.seconds - 1e-9;
      const t = done ? 1 : ease(move.easing, move.elapsed / move.seconds);
      const next: Record<(typeof NUMBERS)[number], number> = { ...slot.picture };
      for (const key of NUMBERS) next[key] = move.from[key] + (move.to[key] - move.from[key]) * t;
      slot.picture = {
        ...slot.picture,
        ...next,
        origin: t >= 1 ? move.to.origin : move.from.origin,
      };
      if (done) slot.move = null;
    }
  }

  /** Every picture, lowest number first (the order they're drawn in). */
  get list(): readonly Picture[] {
    return [...this.slots.values()].map((s) => s.picture).sort((a, b) => a.number - b.number);
  }

  /** For saves: each picture where it is now (a move in progress ends where it is). */
  toData(): Picture[] {
    return this.list.map((p) => ({ ...p }));
  }

  loadData(pictures: readonly Picture[] | undefined): void {
    this.slots.clear();
    for (const p of pictures ?? [])
      this.slots.set(p.number, { picture: { ...p }, move: null, generation: 0 });
  }
}
