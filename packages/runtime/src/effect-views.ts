// Draws animations and balloons: on the map over characters (`CharacterEffectViews`)
// and in battle over battlers (via `AnimationSheets` + `placeAnimation`). Sheets
// load on first use and stay cached; until loaded nothing is drawn (the timing,
// kept by core or the battle controller, doesn't wait for it).
import { type ShownBalloon, animationFrame, balloonFrame } from '@freequest/core';
import type { AnimationEntry, SystemData } from '@freequest/schema';
import { Container, Sprite, type Texture } from 'pixi.js';
import { sliceGrid } from './textures.js';

/** Frames of animation sheets and of the balloon image, cut once each. */
export class AnimationSheets {
  private readonly sheets = new Map<string, Texture | 'loading' | 'failed'>();
  private readonly cut = new Map<string, Texture[]>();

  constructor(private readonly load: (path: string) => Promise<Texture>) {}

  private sheet(path: string): Texture | null {
    const known = this.sheets.get(path);
    if (known === undefined) {
      this.sheets.set(path, 'loading');
      this.load(path).then(
        (texture) => this.sheets.set(path, texture),
        (error: unknown) => {
          console.warn(`Could not load animation image "${path}"`, error);
          this.sheets.set(path, 'failed');
        },
      );
      return null;
    }
    return typeof known === 'string' ? null : known;
  }

  /** Every frame of a sheet cut in `w` × `h` cells (left to right, then down), or null until loaded. */
  frames(path: string, w: number, h: number): Texture[] | null {
    const key = `${path}|${w}|${h}`;
    const done = this.cut.get(key);
    if (done) return done;
    const texture = this.sheet(path);
    if (!texture) return null;
    const columns = Math.max(1, Math.floor(texture.width / w));
    const rows = Math.max(1, Math.floor(texture.height / h));
    const frames = sliceGrid(texture, w, h, columns, columns * rows);
    this.cut.set(key, frames);
    return frames;
  }

  /** The texture an animation shows `elapsed` seconds in (null: no image, or not loaded yet). */
  animation(entry: AnimationEntry, elapsed: number): Texture | null {
    if (!entry.image) return null;
    return (
      this.frames(entry.image, entry.frameWidth, entry.frameHeight)?.[
        animationFrame(entry, elapsed)
      ] ?? null
    );
  }

  /** The texture of a balloon `elapsed` seconds in. */
  balloon(config: NonNullable<SystemData['balloons']>, balloon: ShownBalloon): Texture | null {
    const frames = this.frames(config.image, config.size, config.size);
    return (
      frames?.[balloon.balloon * config.frames + balloonFrame(config.frames, balloon.elapsed)] ??
      null
    );
  }
}

/** Sprites reused frame to frame by key, and the ones not used this frame removed. */
export class SpritePool {
  private readonly sprites = new Map<string, Sprite>();
  private used = new Set<string>();

  constructor(readonly container: Container) {}

  begin(): void {
    this.used = new Set();
  }

  sprite(key: string, texture: Texture): Sprite {
    let sprite = this.sprites.get(key);
    if (!sprite) {
      sprite = new Sprite(texture);
      this.sprites.set(key, sprite);
      this.container.addChild(sprite);
    }
    sprite.texture = texture;
    this.used.add(key);
    return sprite;
  }

  end(): void {
    for (const [key, sprite] of this.sprites) {
      if (this.used.has(key)) continue;
      sprite.destroy();
      this.sprites.delete(key);
    }
  }
}

/** Where a character is drawn: its sprite's feet and height (null: not drawn). */
export type CharacterSpot = (target: string) => { x: number; y: number; height: number } | null;

/** Animations and balloons on the map, in map coordinates, over every character. */
export class CharacterEffectViews {
  readonly container = new Container({ label: 'character-effects' });
  private readonly pool = new SpritePool(this.container);

  constructor(private readonly sheets: AnimationSheets) {}

  render(
    effects: {
      readonly animations: readonly { entry: AnimationEntry; target: string; elapsed: number }[];
      readonly balloons: readonly ShownBalloon[];
    },
    balloons: SystemData['balloons'],
    spot: CharacterSpot,
  ): void {
    this.pool.begin();
    effects.animations.forEach((a, i) => {
      const at = spot(a.target);
      const texture = this.sheets.animation(a.entry, a.elapsed);
      if (!at || !texture) return;
      const sprite = this.pool.sprite(`a${i}`, texture);
      sprite.anchor.set(0.5);
      sprite.position.set(Math.round(at.x), Math.round(at.y - at.height / 2));
    });
    if (balloons) {
      for (const b of effects.balloons) {
        const at = spot(b.target);
        const texture = this.sheets.balloon(balloons, b);
        if (!at || !texture) continue;
        const sprite = this.pool.sprite(`b${b.target}`, texture);
        sprite.anchor.set(0.5, 1);
        sprite.position.set(Math.round(at.x), Math.round(at.y - at.height));
      }
    }
    this.pool.end();
  }
}
