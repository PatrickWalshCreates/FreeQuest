// The plugin API (M15): a plugin's script default-exports `{ setup(api) }`
// and reaches the game only through `api`, which is versioned. Plugins never
// patch engine classes or globals. Core runs the hooks and commands; the
// runtime loads the scripts (and, from step 3, gives them a drawing layer).
import {
  type Direction,
  type PluginDeclaration,
  type PluginValue,
  type PluginValues,
  PLUGIN_API_VERSION,
  resolvePluginValues,
} from '@freequest/schema';
import type { World } from './world.js';

/** What a plugin sees of the running game. Ids are the project's (switches, variables). */
export interface PluginGame {
  /** The map the player is on. */
  readonly map: {
    readonly id: string;
    readonly name: string;
    readonly width: number;
    readonly height: number;
  };
  /** The player's tile and facing. */
  readonly player: { readonly x: number; readonly y: number; readonly direction: Direction };
  readonly gold: number;
  getSwitch(id: string): boolean;
  setSwitch(id: string, value: boolean): void;
  getVariable(id: string): number;
  /** Variables are whole numbers: anything else is refused (the plugin is told). */
  setVariable(id: string, value: number): void;
  /** Play a sound under assets/ once. */
  playSound(path: string): void;
  /**
   * This plugin's own data in this game (a copy): what it last stored with
   * `setData`, from this game or the save it was loaded from; undefined in a
   * new game.
   */
  getData(): unknown;
  /**
   * Store this plugin's data (plain JSON: objects, arrays, strings, numbers,
   * booleans, null), kept in saves. Stored as a copy: change it, then store it again.
   */
  setData(value: unknown): void;
}

/** A plugin command being run by an event. */
export interface PluginCommandCall {
  /** Its arguments, every declared parameter filled in (missing ones by their defaults). */
  readonly args: Readonly<Record<string, PluginValue>>;
  /** The map event running it (null in a common event called from elsewhere, or a battle). */
  readonly event: string | null;
  readonly game: PluginGame;
}

/**
 * What a command handler returns: nothing (the event carries on at once), or
 * a check the event waits on until it returns true (like a screen effect).
 */
export type PluginCommandResult = undefined | (() => boolean);

/** Everything a plugin can do. Hooks and commands are registered in `setup`. */
export interface PluginApi {
  /** The plugin API version this FreeQuest runs. */
  readonly apiVersion: number;
  /** The plugin's id (from its plugin.json). */
  readonly id: string;
  /** The project's settings for it, every declared one filled in. */
  readonly settings: Readonly<Record<string, PluginValue>>;
  /** When a game starts: a new game, or a loaded save (before its map's `onMapLoaded`). */
  onGameStart(hook: (game: PluginGame) => void): void;
  /** When the player arrives on a map (also the first map of a game). */
  onMapLoaded(hook: (game: PluginGame) => void): void;
  /** After each logic step (60 a second) while the map is playing; `dt` in seconds. */
  onStep(hook: (game: PluginGame, dt: number) => void): void;
  /** Handle a command plugin.json declares. Every declared command needs a handler. */
  command(id: string, handler: (call: PluginCommandCall) => PluginCommandResult): void;
}

/** What a plugin's script default-exports. */
export interface PluginModule {
  setup(api: PluginApi): void;
}

/** For plugin authors writing TypeScript: gives `setup`'s `api` its type. Returns its input. */
export function definePlugin(plugin: PluginModule): PluginModule {
  return plugin;
}

/** A plugin that failed: which one, where, and why. It does nothing more this session. */
export class PluginError extends Error {
  override name = 'PluginError';
  constructor(
    /** The plugin's id. */
    readonly plugin: string,
    /** Its display name. */
    readonly pluginName: string,
    /** Where: "load", "setup", "game start", "map loaded", "step", `command "rain"`. */
    readonly hook: string,
    override readonly cause: unknown,
  ) {
    super(
      `Plugin "${pluginName}" stopped working (${hook}): ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
}

/** A plugin ready to start: its declaration, the project's settings for it and its module. */
export interface LoadedPlugin {
  readonly declaration: PluginDeclaration;
  readonly settings?: PluginValues;
  /** The script's default export (checked here: it must have a `setup` function). */
  readonly module: unknown;
}

type Handler = (call: PluginCommandCall) => PluginCommandResult;

interface Entry {
  readonly declaration: PluginDeclaration;
  readonly gameStart: ((game: PluginGame) => void)[];
  readonly mapLoaded: ((game: PluginGame) => void)[];
  readonly step: ((game: PluginGame, dt: number) => void)[];
  readonly commands: Map<string, Handler>;
  failed: boolean;
}

/** One plugin's state for the debug panel. */
export interface PluginStatus {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** False once it has failed. */
  readonly working: boolean;
}

/**
 * Runs the project's enabled plugins: their setup once, then their hooks and
 * commands for whichever world is playing (`start` binds a new one). A plugin
 * that throws is reported once through `onError` and switched off for the
 * rest of the session, so one broken plugin never stops the game.
 */
export class PluginHost {
  private readonly entries: Entry[] = [];
  private readonly onError: (error: PluginError) => void;

  private readonly extend: ((plugin: string) => object) | undefined;

  /**
   * `extend` adds members to each plugin's `api` (the runtime's drawing);
   * they are frozen with it.
   */
  constructor(
    plugins: readonly LoadedPlugin[],
    onError: (error: PluginError) => void,
    extend?: (plugin: string) => object,
  ) {
    this.onError = onError;
    this.extend = extend;
    for (const plugin of plugins) this.setUp(plugin);
  }

  /** Report a plugin that couldn't even be loaded (its script missing or broken). */
  reportLoadFailure(declaration: PluginDeclaration, cause: unknown): void {
    this.onError(new PluginError(declaration.id, declaration.name, 'load', cause));
  }

  get status(): PluginStatus[] {
    return this.entries.map((e) => ({
      id: e.declaration.id,
      name: e.declaration.name,
      version: e.declaration.version,
      working: !e.failed,
    }));
  }

  /** A world starts playing (new game or loaded save): game start, then map loaded. */
  start(world: World): void {
    world.plugins = this;
    for (const entry of this.entries) {
      this.each(entry, 'game start', entry.gameStart, pluginGame(world, entry.declaration.id));
    }
    this.mapLoaded(world);
  }

  /** The world moved to another map. */
  mapLoaded(world: World): void {
    for (const entry of this.entries) {
      this.each(entry, 'map loaded', entry.mapLoaded, pluginGame(world, entry.declaration.id));
    }
  }

  /** After a logic step of the world. */
  afterStep(world: World, dt: number): void {
    for (const entry of this.entries) {
      if (entry.failed || entry.step.length === 0) continue;
      const game = pluginGame(world, entry.declaration.id);
      for (const hook of entry.step) {
        if (!this.guard(entry, 'step', () => hook(game, dt))) break;
      }
    }
  }

  /** The game as one plugin sees it (for runtime additions to the API, such as drawing). */
  gameFor(world: World, plugin: string): PluginGame {
    return pluginGame(world, plugin);
  }

  /**
   * Run code of a plugin's own (a runtime hook such as drawing) the way
   * hooks run: a throw reports it and switches it off. False when it has
   * failed (now or before) or isn't loaded.
   */
  guarded(plugin: string, hook: string, run: () => void): boolean {
    const entry = this.entries.find((e) => e.declaration.id === plugin);
    return entry ? this.guard(entry, hook, run) : false;
  }

  /**
   * Run a plugin command for an event. Returns the check the event waits on,
   * or null to carry on at once (also for a plugin that is off or failed).
   */
  runCommand(
    world: World,
    plugin: string,
    command: string,
    args: PluginValues,
    event: string | null,
  ): (() => boolean) | null {
    const entry = this.entries.find((e) => e.declaration.id === plugin);
    const handler = entry?.commands.get(command);
    if (!entry || entry.failed || !handler) return null;
    const params = entry.declaration.commands.find((c) => c.id === command)?.params ?? [];
    const call: PluginCommandCall = {
      args: resolvePluginValues(params, args),
      event,
      game: pluginGame(world, plugin),
    };
    const where = `command "${command}"`;
    let result: unknown;
    if (!this.guard(entry, where, () => (result = handler(call)))) return null;
    if (result === undefined) return null;
    if (typeof result !== 'function') {
      this.fail(
        entry,
        where,
        new Error('a command handler returns nothing, or a function the event waits on'),
      );
      return null;
    }
    const check = result as () => unknown;
    return () => {
      if (entry.failed) return true;
      let done = true;
      this.guard(entry, where, () => (done = Boolean(check())));
      return done;
    };
  }

  private setUp({ declaration, settings, module }: LoadedPlugin): void {
    const entry: Entry = {
      declaration,
      gameStart: [],
      mapLoaded: [],
      step: [],
      commands: new Map(),
      failed: false,
    };
    this.entries.push(entry);
    const setup = (module as { setup?: unknown } | null)?.setup;
    if (typeof setup !== 'function') {
      this.fail(entry, 'load', new Error('its script must export default { setup(api) { … } }'));
      return;
    }
    let open = true;
    const register = <T>(list: T[], hook: T, what: string) => {
      if (!open) throw new Error(`${what} can only be registered in setup`);
      if (typeof hook !== 'function') throw new Error(`${what} needs a function`);
      list.push(hook);
    };
    const api: PluginApi = {
      ...this.extend?.(declaration.id),
      apiVersion: PLUGIN_API_VERSION,
      id: declaration.id,
      settings: Object.freeze(resolvePluginValues(declaration.settings, settings)),
      onGameStart: (hook) => register(entry.gameStart, hook, 'onGameStart'),
      onMapLoaded: (hook) => register(entry.mapLoaded, hook, 'onMapLoaded'),
      onStep: (hook) => register(entry.step, hook, 'onStep'),
      command: (id, handler) => {
        if (!open) throw new Error('commands can only be registered in setup');
        if (!declaration.commands.some((c) => c.id === id)) {
          throw new Error(`command "${id}" isn't declared in plugin.json`);
        }
        if (typeof handler !== 'function') throw new Error(`command "${id}" needs a function`);
        entry.commands.set(id, handler);
      },
    };
    Object.freeze(api);
    this.guard(entry, 'setup', () => setup.call(module, api));
    open = false;
    if (entry.failed) return;
    const missing = declaration.commands.filter((c) => !entry.commands.has(c.id));
    if (missing.length > 0) {
      this.fail(
        entry,
        'setup',
        new Error(
          `plugin.json declares ${missing.map((c) => `"${c.id}"`).join(', ')}, but setup didn't register ${missing.length === 1 ? 'it' : 'them'} with api.command`,
        ),
      );
    }
  }

  private each(
    entry: Entry,
    hook: string,
    hooks: readonly ((game: PluginGame) => void)[],
    game: PluginGame,
  ): void {
    for (const run of hooks) if (!this.guard(entry, hook, () => run(game))) return;
  }

  /** Run plugin code; on a throw, report it and switch the plugin off. False if it failed. */
  private guard(entry: Entry, hook: string, run: () => void): boolean {
    if (entry.failed) return false;
    try {
      run();
      return true;
    } catch (error) {
      this.fail(entry, hook, error);
      return false;
    }
  }

  private fail(entry: Entry, hook: string, cause: unknown): void {
    entry.failed = true;
    this.onError(new PluginError(entry.declaration.id, entry.declaration.name, hook, cause));
  }
}

/** The game as plugins see it, for one world. */
function pluginGame(world: World, plugin: string): PluginGame {
  const map = world.map;
  return {
    map: { id: map.id, name: map.name, width: map.width, height: map.height },
    player: { x: world.player.x, y: world.player.y, direction: world.player.direction },
    gold: world.party.gold,
    getSwitch: (id) => world.state.getSwitch(id),
    setSwitch: (id, value) => world.state.setSwitch(id, Boolean(value)),
    getVariable: (id) => world.state.getVariable(id),
    setVariable: (id, value) => world.state.setVariable(id, value),
    playSound: (path) => world.eventContext.audio?.playSound(path),
    getData: () => copyJson(world.pluginData.get(plugin)),
    setData: (value) => {
      if (value === undefined) world.pluginData.delete(plugin);
      else world.pluginData.set(plugin, copyJson(value, true));
    },
  };
}

/** Largest data a plugin may keep in saves (as JSON text). */
export const MAX_PLUGIN_DATA = 100_000;

/** A deep copy of plain JSON data; `check` refuses anything else (and anything too big). */
function copyJson(value: unknown, check = false): unknown {
  if (value === undefined) return undefined;
  const text = JSON.stringify(value);
  if (check) {
    if (text === undefined) throw new Error('setData needs plain JSON data');
    if (text.length > MAX_PLUGIN_DATA) {
      throw new Error(`setData: data is ${text.length} characters, more than ${MAX_PLUGIN_DATA}`);
    }
    if (!isPlainJson(value)) {
      throw new Error(
        'setData needs plain JSON data (objects, arrays, strings, numbers, booleans, null)',
      );
    }
  }
  return JSON.parse(text) as unknown;
}

function isPlainJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isPlainJson);
  if (typeof value === 'object') {
    const proto = Object.getPrototypeOf(value) as unknown;
    return (
      (proto === Object.prototype || proto === null) && Object.values(value).every(isPlainJson)
    );
  }
  return false;
}
