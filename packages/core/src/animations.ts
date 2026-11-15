// Animations and balloons on characters: core keeps what plays where and for
// how long (advanced with the world's fixed steps, so "wait until done" and
// sounds are exact); the runtime draws the frame each one is on.
import { type AnimationEntry, animationSeconds } from '@freequest/schema';

/** Balloon frames per second, and how long the last frame stays before it goes. */
export const BALLOON_FPS = 12;
export const BALLOON_HOLD = 0.6;

export function balloonSeconds(frames: number): number {
  return frames / BALLOON_FPS + BALLOON_HOLD;
}

/** The frame an animation shows `elapsed` seconds in (its last one at the end). */
export function animationFrame(
  entry: Pick<AnimationEntry, 'frames' | 'fps'>,
  elapsed: number,
): number {
  return Math.max(0, Math.min(entry.frames - 1, Math.floor(elapsed * entry.fps + 1e-9)));
}

/** The frame a balloon shows `elapsed` seconds in. */
export function balloonFrame(frames: number, elapsed: number): number {
  return Math.max(0, Math.min(frames - 1, Math.floor(elapsed * BALLOON_FPS + 1e-9)));
}

/** Sounds of an animation due in [from, to) seconds (a start at 0 includes frame 0's). */
export function animationSounds(entry: AnimationEntry, from: number, to: number): string[] {
  return entry.sounds
    .filter((s) => {
      const at = s.frame / entry.fps - 1e-9;
      return at >= from - (from === 0 ? 1e-6 : 0) && at < to;
    })
    .map((s) => s.path);
}

/** An animation playing on a character ("player" or a map event's id). */
export interface PlayingAnimation {
  readonly entry: AnimationEntry;
  readonly target: string;
  readonly elapsed: number;
}

/** A balloon over a character. */
export interface ShownBalloon {
  readonly balloon: number;
  readonly frames: number;
  readonly target: string;
  readonly elapsed: number;
}

interface Running<T> {
  readonly item: T;
  elapsed: number;
  readonly seconds: number;
  done: boolean;
}

/** What plays on characters right now. One balloon per character; animations can overlap. */
export class CharacterEffects {
  private animationList: Running<{ entry: AnimationEntry; target: string }>[] = [];
  private readonly balloonList = new Map<string, Running<{ balloon: number; frames: number }>>();

  /** Play an animation; returns a check that's true once it has finished. */
  play(entry: AnimationEntry, target: string): () => boolean {
    const running = {
      item: { entry, target },
      elapsed: 0,
      seconds: animationSeconds(entry),
      done: false,
    };
    this.animationList.push(running);
    return () => running.done;
  }

  /** Show a balloon over a character (replacing one already there). */
  balloon(balloon: number, frames: number, target: string): () => boolean {
    const old = this.balloonList.get(target);
    if (old) old.done = true;
    const running = {
      item: { balloon, frames },
      elapsed: 0,
      seconds: balloonSeconds(frames),
      done: false,
    };
    this.balloonList.set(target, running);
    return () => running.done;
  }

  /** Advance by `dt`; `sound` hears each animation sound as its frame comes. */
  update(dt: number, sound: (path: string) => void): void {
    for (const a of this.animationList) {
      const from = a.elapsed;
      a.elapsed += dt;
      for (const path of animationSounds(a.item.entry, from, a.elapsed)) sound(path);
      if (a.elapsed >= a.seconds - 1e-9) a.done = true;
    }
    this.animationList = this.animationList.filter((a) => !a.done);
    for (const [target, b] of this.balloonList) {
      b.elapsed += dt;
      if (b.elapsed >= b.seconds - 1e-9) {
        b.done = true;
        this.balloonList.delete(target);
      }
    }
  }

  get animations(): readonly PlayingAnimation[] {
    return this.animationList.map((a) => ({
      entry: a.item.entry,
      target: a.item.target,
      elapsed: a.elapsed,
    }));
  }

  get balloons(): readonly ShownBalloon[] {
    return [...this.balloonList].map(([target, b]) => ({ ...b.item, target, elapsed: b.elapsed }));
  }

  /** Stop everything (a new map): waiting events carry on. */
  clear(): void {
    for (const a of this.animationList) a.done = true;
    for (const b of this.balloonList.values()) b.done = true;
    this.animationList = [];
    this.balloonList.clear();
  }
}
