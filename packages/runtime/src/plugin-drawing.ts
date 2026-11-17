// Plugins that draw (M15 step 3): `api.onDraw(hook)` is the runtime's
// addition to core's plugin API. Each drawing plugin gets its own canvas the
// size of the game screen, cleared before every frame and drawn over the map
// (above pictures, under screen effects and windows). Plugins draw with the
// standard Canvas 2D API, so they never depend on the engine's renderer.
// This module is the PixiJS-free part: which plugins draw, and calling them.
import type { PluginApi, PluginGame, PluginHost, World } from '@freequest/core';

/** What a draw hook gets, once per rendered frame. */
export interface PluginFrame {
  /** This plugin's canvas, cleared, the size of the game screen (internal pixels). */
  readonly context: CanvasRenderingContext2D;
  readonly width: number;
  readonly height: number;
  /**
   * The map pixel at the screen's top-left corner: a map position (x, y) in
   * pixels is drawn at (x − camera.x, y − camera.y).
   */
  readonly camera: { readonly x: number; readonly y: number };
  /** The map's tile size in pixels. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** Seconds since the game started (for animation). */
  readonly seconds: number;
  readonly game: PluginGame;
}

/** The runtime's additions to the plugin API. */
export interface PluginDrawApi {
  /** Draw over the map every frame while it's playing (not on the title or in battles). */
  onDraw(hook: (frame: PluginFrame) => void): void;
}

/** The API a game's plugin gets: core's hooks and commands, plus drawing. */
export type GamePluginApi = PluginApi & PluginDrawApi;

/** A frame without the plugin-specific parts. */
export type FrameBase = Omit<PluginFrame, 'context' | 'game'>;

/** Registers draw hooks during setup and runs them per frame. */
export class PluginDrawing {
  private readonly hooks = new Map<string, ((frame: PluginFrame) => void)[]>();
  private sealed = false;

  /** Pass to `PluginHost` (via `loadPlugins`): adds `onDraw` to each plugin's api. */
  readonly extension = (plugin: string): PluginDrawApi => ({
    onDraw: (hook) => {
      if (this.sealed) throw new Error('onDraw can only be registered in setup');
      if (typeof hook !== 'function') throw new Error('onDraw needs a function');
      const list = this.hooks.get(plugin) ?? [];
      list.push(hook);
      this.hooks.set(plugin, list);
    },
  });

  /** After every plugin's setup: no more hooks. */
  seal(): void {
    this.sealed = true;
  }

  /** Plugins with draw hooks, in the order they registered (the manifest's order). */
  get plugins(): string[] {
    return [...this.hooks.keys()];
  }

  /**
   * Run one plugin's draw hooks on its canvas. False when it failed (now or
   * earlier): its canvas should be cleared and hidden.
   */
  draw(
    host: PluginHost,
    world: World,
    plugin: string,
    context: CanvasRenderingContext2D,
    base: FrameBase,
  ): boolean {
    const hooks = this.hooks.get(plugin) ?? [];
    const frame: PluginFrame = { ...base, context, game: host.gameFor(world, plugin) };
    return host.guarded(plugin, 'draw', () => {
      for (const hook of hooks) {
        context.save();
        try {
          hook(frame);
        } finally {
          context.restore();
        }
      }
    });
  }
}
