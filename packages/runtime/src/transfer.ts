// Map transfer flow: fade out, load the target map, swap it into the world,
// fade in, then let the event continue. Free of PixiJS so it can be tested in
// Node; the game draws `fade` as a black overlay.
import type { InterpreterRequest, World } from '@freequest/core';
import type { GameMap, Tileset } from '@freequest/schema';

export interface LoadedMap {
  readonly map: GameMap;
  readonly tileset: Tileset;
}

/** Fetches a map and everything needed to show it (e.g. its tileset image). */
export type MapLoader = (mapId: string) => Promise<LoadedMap>;

type TransferRequest = Extract<InterpreterRequest, { type: 'transfer' }>;

type Phase =
  | { kind: 'idle' }
  | { kind: 'out'; request: TransferRequest; elapsed: number }
  | { kind: 'in'; request: TransferRequest; elapsed: number };

export interface TransferOptions {
  /** Seconds for each of the fade out and fade in. 0 switches instantly. */
  fadeSeconds?: number;
  /** Called if the target map fails to load. The transfer is skipped and the event continues. */
  onError?: (error: unknown, request: TransferRequest) => void;
}

export class TransferController {
  private readonly fadeSeconds: number;
  private readonly onError: (error: unknown, request: TransferRequest) => void;
  private phase: Phase = { kind: 'idle' };
  private loaded: LoadedMap | null = null;
  private failed: { error: unknown } | null = null;

  constructor(
    private readonly loadMap: MapLoader,
    options: TransferOptions = {},
  ) {
    this.fadeSeconds = options.fadeSeconds ?? 0.25;
    this.onError =
      options.onError ??
      ((error, request) => console.error(`Transfer to map "${request.map}" failed`, error));
  }

  /** True while a transfer is in progress. */
  get isActive(): boolean {
    return this.phase.kind !== 'idle';
  }

  /** Opacity of the black overlay, 0 (clear) to 1 (black). */
  get fade(): number {
    const { phase, fadeSeconds } = this;
    if (phase.kind === 'idle') return 0;
    const t = fadeSeconds > 0 ? Math.min(phase.elapsed / fadeSeconds, 1) : 1;
    return phase.kind === 'out' ? t : 1 - t;
  }

  /** Call once per fixed logic step, before the world steps. */
  update(dt: number, world: World): void {
    const phase = this.phase;

    if (phase.kind === 'idle') {
      const request = world.interpreter?.pending;
      if (request?.type !== 'transfer') return;
      this.phase = { kind: 'out', request, elapsed: 0 };
      this.loaded = null;
      this.failed = null;
      // Load while fading out, so short loads add no delay.
      this.loadMap(request.map).then(
        (loaded) => (this.loaded = loaded),
        (error: unknown) => (this.failed = { error }),
      );
      return;
    }

    phase.elapsed += dt;

    if (phase.kind === 'out') {
      // Hold on black until the map is ready.
      if (phase.elapsed < this.fadeSeconds) return;
      if (this.failed) {
        this.onError(this.failed.error, phase.request);
        this.phase = { kind: 'in', request: phase.request, elapsed: 0 };
        return;
      }
      if (!this.loaded) return;
      const { request } = phase;
      try {
        world.changeMap(
          this.loaded.map,
          this.loaded.tileset,
          request.x,
          request.y,
          request.direction ?? undefined,
        );
      } catch (error) {
        // Invalid target (e.g. out of bounds): skip the change, keep the event going.
        this.onError(error, request);
      }
      this.phase = { kind: 'in', request, elapsed: 0 };
      return;
    }

    if (phase.elapsed >= this.fadeSeconds) {
      this.phase = { kind: 'idle' };
      // Answer only our own request, never whatever the event does next.
      if (world.interpreter?.pending === phase.request) world.interpreter.continue();
    }
  }
}
