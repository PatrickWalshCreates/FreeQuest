// Screen effects events ask for: fading to black and back, a lasting tint, a
// flash and a shake. Core keeps what they are at each moment (advanced with
// the world's fixed steps, so they're testable and deterministic); the
// runtime only draws them.

/** How opaque a flash starts (it fades to nothing over its time). */
export const FLASH_START = 0.8;

/** Shakes per second (side to side and back). */
const SHAKE_RATE = 12;

type Rgb = readonly [number, number, number];

const toRgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const toHex = ([r, g, b]: Rgb) =>
  `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** A value moving from `from` to `to` over `seconds`. */
class Tween {
  private elapsed = 0;
  constructor(
    readonly from: number,
    readonly to: number,
    readonly seconds: number,
  ) {}
  update(dt: number): void {
    this.elapsed += dt;
  }
  get progress(): number {
    // Within float rounding of the end counts as the end (60 steps of 1/60 s make 1 s).
    if (this.seconds <= 0 || this.elapsed >= this.seconds - 1e-9) return 1;
    return this.elapsed / this.seconds;
  }
  get value(): number {
    return lerp(this.from, this.to, this.progress);
  }
  get done(): boolean {
    return this.progress >= 1;
  }
}

/** What saves keep: the tint and the fade, as events left them. */
export interface ScreenData {
  readonly fade: number;
  readonly tint: { readonly color: string; readonly strength: number };
}

/** The screen's effects. Commands start them; each returns a "finished" check to wait on. */
export class ScreenEffects {
  private fadeTween = new Tween(0, 0, 0);
  private tintStart: Rgb = [0, 0, 0];
  private tintEnd: Rgb = [0, 0, 0];
  private tintTween = new Tween(0, 0, 0);
  private flashColor = '#ffffff';
  private flashTween = new Tween(0, 0, 0);
  private shakePower = 0;
  private shakeTween = new Tween(0, 0, 0);
  private time = 0;

  /** Advance every effect by `dt` seconds. */
  update(dt: number): void {
    this.time += dt;
    for (const tween of [this.fadeTween, this.tintTween, this.flashTween, this.shakeTween]) {
      tween.update(dt);
    }
  }

  /** How black the screen is: 0 = not at all, 1 = completely. */
  get fade(): number {
    return this.fadeTween.value;
  }

  /** The tint now: its colour and strength (0 = none). */
  get tint(): { readonly color: string; readonly strength: number } {
    const t = this.tintTween.progress;
    const rgb: Rgb = [0, 1, 2].map((i) =>
      lerp(this.tintStart[i] ?? 0, this.tintEnd[i] ?? 0, t),
    ) as never;
    return { color: toHex(rgb), strength: this.tintTween.value };
  }

  /** The flash now: its colour and how opaque it is (0 = gone). */
  get flash(): { readonly color: string; readonly alpha: number } {
    return { color: this.flashColor, alpha: this.flashTween.value };
  }

  /** How far the screen is shaken sideways right now, in whole pixels (0 when still). */
  get shakeX(): number {
    if (this.shakeTween.done) return 0;
    // Strongest at the start, calming down to nothing.
    const power = this.shakePower * (1 - this.shakeTween.progress * 0.5);
    return Math.round(Math.sin(this.time * SHAKE_RATE * 2 * Math.PI) * power);
  }

  fadeTo(to: 'out' | 'in', seconds: number): () => boolean {
    const tween = new Tween(this.fade, to === 'out' ? 1 : 0, seconds);
    this.fadeTween = tween;
    return () => tween.done || this.fadeTween !== tween;
  }

  tintTo(color: string, strength: number, seconds: number): () => boolean {
    const now = this.tint;
    // From no tint, only the strength changes: the colour starts as the new one.
    this.tintStart = now.strength > 0 ? toRgb(now.color) : toRgb(color);
    this.tintEnd = toRgb(color);
    const tween = new Tween(now.strength, strength, seconds);
    this.tintTween = tween;
    return () => tween.done || this.tintTween !== tween;
  }

  flashOnce(color: string, seconds: number): () => boolean {
    this.flashColor = color;
    const tween = new Tween(FLASH_START, 0, seconds);
    this.flashTween = tween;
    return () => tween.done || this.flashTween !== tween;
  }

  shake(power: number, seconds: number): () => boolean {
    this.shakePower = power;
    const tween = new Tween(1, 0, seconds);
    this.shakeTween = tween;
    return () => tween.done || this.shakeTween !== tween;
  }

  /** The lasting part (fade and tint), for saves. */
  toData(): ScreenData {
    return { fade: this.fade, tint: this.tint };
  }

  /** Restore a save's fade and tint at once. */
  loadData(data: ScreenData | undefined): void {
    this.fadeTween = new Tween(data?.fade ?? 0, data?.fade ?? 0, 0);
    const color = toRgb(data?.tint.color ?? '#000000');
    this.tintStart = color;
    this.tintEnd = color;
    const strength = data?.tint.strength ?? 0;
    this.tintTween = new Tween(strength, strength, 0);
  }
}
