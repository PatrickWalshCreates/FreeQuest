import type { World } from './world.js';

/**
 * Plugin API (stub, not implemented yet).
 *
 * Plugins will be typed objects that register hooks; the engine calls hooks
 * at defined points. Plugins never patch engine classes or globals. Hook
 * names and signatures here are placeholders and will change before the API
 * is declared stable.
 */
export interface FreeQuestPlugin {
  /** Unique id, e.g. "my-org.day-night". */
  readonly id: string;
  readonly hooks?: PluginHooks;
}

export interface PluginHooks {
  /** After a world is created, before the first step. */
  worldCreated?(world: World): void;
  /** After each fixed logic step. */
  afterStep?(world: World, dt: number): void;
}
