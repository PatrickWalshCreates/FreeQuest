export interface FixedTimestepOptions {
  /** Logic steps per second. */
  stepsPerSecond?: number;
  /** Longest real frame time honoured, in seconds, so a stall can't trigger a burst of steps. */
  maxFrameTime?: number;
}

/**
 * Accumulator for a fixed-timestep loop. The runtime feeds it real elapsed
 * time from its render loop; it runs whole logic steps and returns the
 * interpolation factor (0..1) for rendering between the last two states.
 */
export class FixedTimestep {
  readonly dt: number;
  private readonly maxFrameTime: number;
  private accumulator = 0;

  constructor(options: FixedTimestepOptions = {}) {
    this.dt = 1 / (options.stepsPerSecond ?? 60);
    this.maxFrameTime = options.maxFrameTime ?? 0.25;
  }

  advance(elapsedSeconds: number, step: (dt: number) => void): number {
    this.accumulator += Math.min(Math.max(elapsedSeconds, 0), this.maxFrameTime);
    while (this.accumulator >= this.dt) {
      step(this.dt);
      this.accumulator -= this.dt;
    }
    return this.accumulator / this.dt;
  }
}
