import {
  type Command,
  type CommandOf,
  type GameMap,
  type Manifest,
  SAVE_FORMAT_VERSION,
  type SaveFile,
  type Tileset,
  emptyDatabase,
} from '@freequest/schema';
import { ScreenEffects } from './screen.js';
import { CollisionMap, type Passability } from './collision.js';
import { DatabaseIndex } from './database.js';
import { DIRECTIONS, DIRECTION_DELTA, type Direction } from './direction.js';
import { EventInstance } from './events.js';
import { type AudioSink, type EventContext, GameState } from './game-state.js';
import { GridMover, type MoveHooks } from './grid-mover.js';
import type { InputState } from './input.js';
import { Interpreter } from './interpreter.js';
import { RouteRunner, type RouteSurroundings } from './route.js';
import { Party } from './party.js';

export interface WorldOptions {
  manifest: Manifest;
  map: GameMap;
  tileset: Tileset;
  /** Shared across maps. Defaults to a fresh state for the manifest. */
  state?: GameState;
  /** The project's database. Defaults to an empty one. */
  database?: DatabaseIndex;
  /** Defaults to the manifest's starting party and gold. */
  party?: Party;
  /** Uniform random in [0, 1) for encounters. Inject a fixed one in tests. */
  random?: () => number;
  /** Where the player starts on `map`. Defaults to the manifest's start. */
  position?: { x: number; y: number; direction: Direction };
}

/** Everything `World.fromSave` needs besides the save itself. */
export interface RestoreOptions {
  manifest: Manifest;
  /** The saved map (its id must match the save). */
  map: GameMap;
  tileset: Tileset;
  database: DatabaseIndex;
  random?: () => number;
}

const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

/**
 * The live game: the current map, its events, the player and the shared game
 * state. Advanced only through `step`. `changeMap` swaps the map in place.
 */
export class World {
  readonly player: GridMover;
  readonly state: GameState;
  readonly db: DatabaseIndex;
  readonly party: Party;
  /** Tile collision plus events that block. What characters move against. */
  readonly passability: Passability;

  private currentMap: GameMap;
  private currentTileset: Tileset;
  private currentCollision: CollisionMap;
  private currentEvents: EventInstance[];
  private running: Interpreter | null = null;
  private runningEvent: EventInstance | null = null;
  /** Fades, tints, flashes and shakes: game-wide, kept across maps (and the tint in saves). */
  readonly screen = new ScreenEffects();
  /** Interpreters of parallel pages, running alongside play (one per event). */
  private readonly parallels = new Map<EventInstance, Interpreter>();
  /** Interpreters of parallel common events, by id. */
  private readonly commonParallels = new Map<string, Interpreter>();
  /** Common events whose pass finished as the running event (they restart next step). */
  private readonly finishedCommons = new Set<string>();
  /** The common event running as the blocking event, if that's what runs. */
  private runningCommon: string | null = null;
  /** Routes started by moveRoute commands, by character (they replace page movement meanwhile). */
  private readonly routes = new Map<EventInstance | 'player', RouteRunner>();
  /** Routes of pages whose movement is a route, with the page they belong to. */
  private readonly pageRoutes = new Map<EventInstance, { page: number; runner: RouteRunner }>();
  /** The player's speed before a route changed it (restored when the route ends). */
  private playerSpeed: number;
  /** Events whose pass finished as the running event this step (they start again next step). */
  private readonly finishedRunning = new Set<EventInstance>();
  private seenVersion: string;
  private readonly random: () => number;
  /** Steps left until the next random encounter on this map. */
  private encounterCountdown = Infinity;
  private pendingEncounter: string | null = null;
  /** Music set by an event; undefined = use the map's own. Cleared on map change. */
  private musicOverride: string | null | undefined = undefined;
  private readonly sounds: string[] = [];
  private readonly audio: AudioSink = {
    playMusic: (path) => {
      this.musicOverride = path;
    },
    playSound: (path) => {
      this.sounds.push(path);
    },
  };

  constructor({ manifest, map, tileset, state, database, party, random, position }: WorldOptions) {
    this.random = random ?? Math.random;
    this.state = state ?? new GameState(manifest);
    this.db = database ?? new DatabaseIndex(emptyDatabase());
    this.party = party ?? Party.start(this.db, manifest.start);
    const start = position ?? manifest.start;
    this.player = new GridMover({
      x: start.x,
      y: start.y,
      direction: start.direction,
      speed: manifest.player.speed,
    });
    this.playerSpeed = manifest.player.speed;
    // Assigned for the type checker; `enterMap` sets them for real.
    this.currentMap = map;
    this.currentTileset = tileset;
    this.currentCollision = CollisionMap.fromMap(map, tileset);
    this.currentEvents = [];
    this.enterMap(map, tileset, start.x, start.y);
    this.seenVersion = this.versionKey();
    const currentMap = () => this.currentMap;
    this.passability = {
      get width() {
        return currentMap().width;
      },
      get height() {
        return currentMap().height;
      },
      isPassable: (x, y) => this.collision.isPassable(x, y) && !this.blockingEventAt(x, y),
    };
  }

  get map(): GameMap {
    return this.currentMap;
  }

  get tileset(): Tileset {
    return this.currentTileset;
  }

  get collision(): CollisionMap {
    return this.currentCollision;
  }

  get events(): readonly EventInstance[] {
    return this.currentEvents;
  }

  private enterMap(map: GameMap, tileset: Tileset, x: number, y: number): void {
    if (map.tileset !== tileset.id) {
      throw new Error(`map "${map.id}" uses tileset "${map.tileset}", got "${tileset.id}"`);
    }
    const collision = CollisionMap.fromMap(map, tileset);
    if (!collision.inBounds(x, y)) {
      throw new Error(`position (${x}, ${y}) is outside map "${map.id}"`);
    }
    this.currentMap = map;
    this.currentTileset = tileset;
    this.currentCollision = collision;
    this.currentEvents = map.events.map((e) => new EventInstance(e, this.eventContext));
    // The old map's parallel events and routes stop; the new map's start on the next step.
    // Parallel common events start their pass again too (they may refer to map events).
    this.parallels.clear();
    this.commonParallels.clear();
    this.endPlayerRoute();
    this.routes.clear();
    this.pageRoutes.clear();
    this.player.placeAt(x, y);
    this.pendingEncounter = null;
    this.encounterCountdown = this.rollEncounterSteps();
    this.musicOverride = undefined;
  }

  /**
   * Move the player to (x, y) on `map`, which becomes the current map. Its
   * events start fresh. A running interpreter keeps running (so an event can
   * transfer and then keep talking), but it no longer belongs to a map event.
   */
  changeMap(map: GameMap, tileset: Tileset, x: number, y: number, direction?: Direction): void {
    this.enterMap(map, tileset, x, y);
    if (direction) this.player.direction = direction;
    this.runningEvent = null;
  }

  /**
   * Steps until the next encounter: around the map's average (0.5× to 1.5×).
   * Infinity on maps without encounters.
   */
  private rollEncounterSteps(): number {
    const encounters = this.currentMap.encounters;
    if (!encounters) return Infinity;
    return Math.max(1, Math.round(encounters.steps * (0.5 + this.random())));
  }

  private countEncounterStep(): void {
    const encounters = this.currentMap.encounters;
    if (!encounters || this.pendingEncounter !== null) return;
    this.encounterCountdown--;
    if (this.encounterCountdown > 0) return;
    const total = encounters.troops.reduce((sum, t) => sum + t.weight, 0);
    let roll = this.random() * total;
    const pick = encounters.troops.find((t) => (roll -= t.weight) < 0) ?? encounters.troops.at(-1);
    this.pendingEncounter = pick?.troop ?? null;
    this.encounterCountdown = this.rollEncounterSteps();
  }

  /** True while a random encounter is waiting to be taken. */
  get hasPendingEncounter(): boolean {
    return this.pendingEncounter !== null;
  }

  /**
   * A random encounter the player just walked into (the troop id), handed
   * over once. The player stays put until it is taken.
   */
  takeEncounter(): string | null {
    const troop = this.pendingEncounter;
    this.pendingEncounter = null;
    return troop;
  }

  /**
   * A save file of the game as it is now. Only valid when no event is
   * running: saving happens from the menu. Parallel events aren't saved;
   * they start again from the top after loading.
   */
  toSave(options: { game: string; playSeconds: number; savedAt?: Date }): SaveFile {
    if (this.running) throw new Error('cannot save while an event is running');
    const party = this.party.toData();
    return {
      formatVersion: SAVE_FORMAT_VERSION,
      game: options.game,
      savedAt: (options.savedAt ?? new Date()).toISOString(),
      playSeconds: Math.max(0, options.playSeconds),
      map: this.map.id,
      x: this.player.x,
      y: this.player.y,
      direction: this.player.direction,
      ...this.state.toData(),
      screen: this.screen.toData(),
      party: {
        members: party.members,
        gold: party.gold,
        items: party.items,
        equipment: party.equipment,
        steps: party.steps,
      },
      summary: {
        location: this.map.name,
        members: this.party.members.map((m) => ({ name: m.name, level: m.level })),
      },
    };
  }

  /** Rebuild a game from a save file. Throws if the save doesn't fit the project. */
  static fromSave(save: SaveFile, options: RestoreOptions): World {
    if (options.map.id !== save.map) {
      throw new Error(`save is on map "${save.map}" but map "${options.map.id}" was given`);
    }
    const state = new GameState(options.manifest);
    state.loadData(save);
    const party = Party.fromData(options.database, save.party);
    const world = new World({
      manifest: options.manifest,
      map: options.map,
      tileset: options.tileset,
      database: options.database,
      state,
      party,
      position: { x: save.x, y: save.y, direction: save.direction },
      ...(options.random ? { random: options.random } : {}),
    });
    world.screen.loadData(save.screen);
    return world;
  }

  /** Map size in pixels. */
  get pixelWidth(): number {
    return this.map.width * this.tileset.tileWidth;
  }

  get pixelHeight(): number {
    return this.map.height * this.tileset.tileHeight;
  }

  /** The blocking event currently running, if any. */
  get interpreter(): Interpreter | null {
    return this.running;
  }

  /** The map event whose commands are running, if the running commands came from one. */
  get interpreterEvent(): EventInstance | null {
    return this.runningEvent;
  }

  /**
   * Start running commands. While they run, the player finishes the tile it
   * is on but takes no new steps. Only one blocking interpreter runs at a time.
   */
  run(commands: readonly Command[], source: EventInstance | null = null): Interpreter {
    if (this.running) throw new Error('an event is already running');
    this.running = new Interpreter(commands, this.contextFor(source));
    this.runningEvent = source;
    this.runningCommon = null;
    return this.running;
  }

  /** Events whose parallel pages are running in the background right now (for tests and debugging). */
  get parallelEvents(): readonly EventInstance[] {
    return [...this.parallels.keys()];
  }

  /** Ids of the parallel common events running right now. */
  get parallelCommonEvents(): readonly string[] {
    return [...this.commonParallels.keys()];
  }

  /** The common event running as the blocking event (an autorun one, or a promoted pass). */
  get interpreterCommonEvent(): string | null {
    return this.runningCommon;
  }

  /** True when a common event with this trigger should run now (its switch, if any, is on). */
  private activeCommons(trigger: 'autorun' | 'parallel') {
    return this.db.commonEvents.all.filter(
      (c) => c.trigger === trigger && (c.switch === undefined || this.state.getSwitch(c.switch)),
    );
  }

  /**
   * Run parallel pages for `dt` seconds. Each present parallel page has its
   * own interpreter; a pass that finishes starts again on the next step (not
   * this one, so a page without waits runs once per step). A pass always
   * finishes, even if its page changes meanwhile; it just doesn't start again.
   * A pass that needs the screen (a message, a choice, a battle, a transfer)
   * waits until no other event runs, then becomes the running event, so the
   * player waits for it like for any other event.
   */
  private advanceParallels(dt: number): void {
    const finished = new Set(this.finishedRunning);
    this.finishedRunning.clear();
    for (const [event, interpreter] of this.parallels) {
      interpreter.update(dt);
      if (interpreter.isDone) {
        this.parallels.delete(event);
        finished.add(event);
      }
    }
    for (const event of this.events) {
      const page = event.page;
      if (page?.trigger !== 'parallel' || this.parallels.has(event)) continue;
      if (finished.has(event) || event === this.runningEvent) continue;
      const interpreter = new Interpreter(page.commands, this.contextFor(event));
      interpreter.update(dt);
      if (!interpreter.isDone) this.parallels.set(event, interpreter);
    }
    // Parallel common events work the same, game-wide, while their switch is on.
    const finishedCommons = new Set(this.finishedCommons);
    this.finishedCommons.clear();
    for (const [id, interpreter] of this.commonParallels) {
      interpreter.update(dt);
      if (interpreter.isDone) {
        this.commonParallels.delete(id);
        finishedCommons.add(id);
      }
    }
    for (const common of this.activeCommons('parallel')) {
      const id = common.id;
      if (this.commonParallels.has(id) || finishedCommons.has(id) || id === this.runningCommon) {
        continue;
      }
      const interpreter = new Interpreter(common.commands, this.contextFor(null));
      interpreter.update(dt);
      if (!interpreter.isDone) this.commonParallels.set(id, interpreter);
    }
    this.refreshEvents();
    this.promoteParallel();
  }

  /** Hand the screen to the first parallel pass waiting for it, when nothing else runs. */
  private promoteParallel(): void {
    if (this.running || this.pendingEncounter !== null) return;
    for (const [event, interpreter] of this.parallels) {
      if (interpreter.pending === null) continue;
      this.parallels.delete(event);
      this.running = interpreter;
      this.runningEvent = event;
      return;
    }
    for (const [id, interpreter] of this.commonParallels) {
      if (interpreter.pending === null) continue;
      this.commonParallels.delete(id);
      this.running = interpreter;
      this.runningCommon = id;
      return;
    }
  }

  /** Present events (with an active page) at a tile, in map order. */
  eventsAt(x: number, y: number): EventInstance[] {
    return this.events.filter((e) => e.page !== null && e.x === x && e.y === y);
  }

  private blockingEventAt(x: number, y: number, except?: EventInstance): boolean {
    return this.events.some((e) => e !== except && e.blocks && e.occupies(x, y));
  }

  /** True if the player takes up (x, y): its tile, and the one it's leaving while it walks. */
  private playerOccupies(x: number, y: number): boolean {
    const p = this.player;
    if (x === p.x && y === p.y) return true;
    return p.isMoving && Math.abs(p.realX - x) < 1 && Math.abs(p.realY - y) < 1;
  }

  /** Where a moving event may step: walkable tiles, never into blocking events or the player. */
  private passabilityFor(event: EventInstance): Passability {
    return {
      width: this.currentMap.width,
      height: this.currentMap.height,
      isPassable: (x, y) =>
        this.collision.isPassable(x, y) &&
        !this.blockingEventAt(x, y, event) &&
        !(event.blocks && this.playerOccupies(x, y)),
    };
  }

  /** The way an event with movement wants to step next, or null to stay put. */
  private nextStep(event: EventInstance, passability: Passability): Direction | null {
    const movement = event.page?.movement;
    if (!movement) return null;
    if (movement.type === 'random') {
      return DIRECTIONS[Math.floor(this.random() * DIRECTIONS.length)] ?? null;
    }
    // Approach: close the longer gap first; if that way is blocked, try the other.
    const dx = this.player.x - event.x;
    const dy = this.player.y - event.y;
    if (dx === 0 && dy === 0) return null;
    const horizontal: Direction | null = dx === 0 ? null : dx > 0 ? 'right' : 'left';
    const vertical: Direction | null = dy === 0 ? null : dy > 0 ? 'down' : 'up';
    const ways = (
      Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal]
    ).filter((d): d is Direction => d !== null);
    const isOpen = (d: Direction) => {
      const { dx: sx, dy: sy } = DIRECTION_DELTA[d];
      return passability.isPassable(event.x + sx, event.y + sy);
    };
    const open = ways.find(isOpen);
    if (open) return open;
    // Next to the player: turn to them (and bump into them, for touch events).
    if (Math.abs(dx) + Math.abs(dy) === 1) return ways[0] ?? null;
    // Straight in line and blocked: sidestep (either way, at random) to get round it.
    if (ways.length === 1 && ways[0]) {
      const sides: Direction[] = horizontal ? ['up', 'down'] : ['left', 'right'];
      if (this.random() < 0.5) sides.reverse();
      const side = sides.find(isOpen);
      if (side) return side;
    }
    return ways[0] ?? null;
  }

  /**
   * Walk events that move on their own. Each finishes the tile it's on, then
   * stands still for its page's pause before the next step. The event whose
   * commands are running stands still (so an NPC doesn't walk off mid-talk).
   * A blocking touch event that walks into the player starts its commands.
   */
  private moveEvents(dt: number): void {
    for (const event of this.events) {
      const mover = event.mover;
      const passability = this.passabilityFor(event);
      const hooks = this.eventHooks(event);
      // A moveRoute command's route comes first, even for the event that runs it.
      const route = this.routes.get(event);
      if (route) {
        route.update(dt, mover, passability, this.surroundings, hooks);
        if (route.isDone(mover)) {
          this.routes.delete(event);
          // Its own movement takes over after a pause, not straight away.
          event.pauseLeft = event.page?.movement?.pause ?? 0;
        }
        continue;
      }
      const movement = event.page?.movement;
      if (!movement && !mover.isMoving) continue;
      const still = event === this.runningEvent || !movement;
      if (movement?.type === 'route') {
        let own = this.pageRoutes.get(event);
        if (!own || own.page !== event.pageIndex) {
          own = {
            page: event.pageIndex,
            runner: new RouteRunner(movement.steps, {
              repeat: true,
              skipBlocked: true,
              pause: movement.pause,
            }),
          };
          this.pageRoutes.set(event, own);
          mover.speed = movement.speed;
        }
        if (still) mover.update(dt, passability, () => null, hooks);
        else own.runner.update(dt, mover, passability, this.surroundings, hooks);
        continue;
      }
      if (movement) mover.speed = movement.speed;
      let wanted: Direction | null = null;
      if (movement && !mover.isMoving && !still) {
        event.pauseLeft -= dt;
        if (event.pauseLeft > 0) continue;
        wanted = this.nextStep(event, passability);
        const jitter = movement.type === 'random' ? 0.5 + this.random() : 1;
        // Counted from now; a step that starts adds its walking time on top.
        event.pauseLeft = movement.pause * jitter;
        if (wanted === null) continue;
      }
      let offered = false;
      mover.update(
        dt,
        passability,
        () => {
          if (offered) return null;
          offered = true;
          return wanted;
        },
        hooks,
      );
    }
  }

  /** A blocking touch event that walks into the player starts its commands. */
  private eventHooks(event: EventInstance): MoveHooks {
    return {
      bumped: (x, y) => {
        const page = event.page;
        if (page?.trigger !== 'touch' || !event.blocks || this.running) return;
        if (x === this.player.x && y === this.player.y) this.run(page.commands, event);
      },
    };
  }

  /** Start the first present event at (x, y) matching `accept`. Returns true if one started. */
  private triggerAt(x: number, y: number, accept: (e: EventInstance) => boolean): boolean {
    if (this.running) return false;
    const event = this.eventsAt(x, y).find(accept);
    const page = event?.page;
    if (!event || !page) return false;
    this.run(page.commands, event);
    return true;
  }

  /** What event conditions and commands see: switches, variables, the party, audio and routes. */
  get eventContext(): EventContext {
    return {
      state: this.state,
      party: this.party,
      audio: this.audio,
      routes: this.routeHost,
      map: this.currentMap.id,
      commonEvent: this.commonEventCommands,
      screen: this.screen,
      hideEvent: this.hideEventById,
    };
  }

  /** The context for the commands of one map event (so "this" in a route means it). */
  private contextFor(event: EventInstance | null): EventContext {
    return { ...this.eventContext, self: event?.id ?? null };
  }

  private readonly commonEventCommands = (id: string) => this.db.commonEvents.get(id).commands;

  private readonly hideEventById = (id: string, hidden: boolean) => {
    this.events.find((e) => e.id === id)?.setHidden(hidden, this.eventContext);
  };

  private readonly routeHost = {
    start: (command: CommandOf<'moveRoute'>, self: string | null) => this.startRoute(command, self),
  };

  /** What routes see: where the player is, and the world's random numbers. */
  private get surroundings(): RouteSurroundings {
    return { player: this.player, random: this.random };
  }

  /**
   * Start a moveRoute command's route on its target, replacing any route it
   * had. Returns a check that's true once the route has ended (or the target
   * doesn't exist, e.g. "this" after the map changed).
   */
  private startRoute(command: CommandOf<'moveRoute'>, self: string | null): () => boolean {
    const target =
      command.target === 'player'
        ? 'player'
        : this.events.find((e) => e.id === (command.target === 'this' ? self : command.target));
    if (!target) return () => true;
    if (target === 'player') this.endPlayerRoute();
    // An event walks a route at its page's speed until a speed step says otherwise.
    else if (target.page?.movement) target.mover.speed = target.page.movement.speed;
    const runner = new RouteRunner(command.steps, {
      repeat: command.repeat,
      skipBlocked: command.skipBlocked,
    });
    this.routes.set(target, runner);
    return () => this.routes.get(target) !== runner;
  }

  /** Stop the player's route, if any, and give back the speed it may have changed. */
  private endPlayerRoute(): void {
    if (!this.routes.delete('player')) return;
    this.player.speed = this.playerSpeed;
  }

  /** True while a move route walks the player (input doesn't move it meanwhile). */
  get playerOnRoute(): boolean {
    return this.routes.has('player');
  }

  /** The music that should be playing on the map: an event's choice, else the map's, else none. */
  get music(): string | null {
    return this.musicOverride !== undefined ? this.musicOverride : (this.currentMap.music ?? null);
  }

  /** Sounds events asked for since the last call, in order. */
  drainSounds(): string[] {
    return this.sounds.splice(0);
  }

  /** Changes whenever anything an event page condition can read changes. */
  private versionKey(): string {
    return `${this.state.version}:${this.party.version}`;
  }

  private refreshEvents(): void {
    const version = this.versionKey();
    if (version === this.seenVersion) return;
    this.seenVersion = version;
    const context = this.eventContext;
    for (const event of this.events) event.refresh(context, event === this.runningEvent);
  }

  /** Talk to / examine: the event in front of the player, or one underfoot that isn't on the same layer. */
  private tryAction(): void {
    const { x, y, direction } = this.player;
    const { dx, dy } = DIRECTION_DELTA[direction];
    const isAction = (e: EventInstance) => e.page?.trigger === 'action';
    const ahead = (e: EventInstance) => isAction(e) && e.blocks;
    if (this.triggerAt(x + dx, y + dy, ahead)) {
      const event = this.runningEvent;
      // Chests, signs and statues keep their facing (`fixed`); people turn to the player.
      const graphic = event?.page?.graphic;
      if (event && graphic && !graphic.fixed) event.direction = OPPOSITE[direction];
      return;
    }
    this.triggerAt(x, y, (e) => isAction(e) && !e.blocks);
  }

  /** The map's first autorun page, else the first autorun common event whose switch is on. */
  private tryAutorun(): void {
    const event = this.events.find((e) => e.page?.trigger === 'autorun');
    if (event?.page) {
      this.run(event.page.commands, event);
      return;
    }
    const common = this.activeCommons('autorun')[0];
    if (common) {
      this.run(common.commands);
      this.runningCommon = common.id;
    }
  }

  private readonly moveHooks: MoveHooks = {
    // Every completed step counts for the party (states, poison), and
    // stepping onto a walk-over touch event triggers it.
    arrived: (x, y) => {
      this.party.onStep();
      this.triggerAt(x, y, (e) => e.page?.trigger === 'touch' && !e.blocks);
      // A step that started an event never also starts a fight.
      if (!this.running) this.countEncounterStep();
    },
    // Walking into a touch event that blocks.
    bumped: (x, y) => {
      this.triggerAt(x, y, (e) => e.page?.trigger === 'touch' && e.blocks);
    },
  };

  /** Run the current interpreter for `dt` seconds and clear it once it finishes. */
  private advanceInterpreter(dt: number): void {
    if (!this.running) return;
    this.running.update(dt);
    this.refreshEvents();
    if (this.running.isDone) {
      if (this.runningEvent) this.finishedRunning.add(this.runningEvent);
      if (this.runningCommon) this.finishedCommons.add(this.runningCommon);
      this.running = null;
      this.runningEvent = null;
      this.runningCommon = null;
    }
  }

  /** Advance the simulation by one fixed step of `dt` seconds. */
  step(dt: number, input: InputState): void {
    this.screen.update(dt);
    this.refreshEvents();
    // An event running at the start of this step owns this step's input, so
    // the confirm press that closes its last message can't start a new one.
    const runningAtStart = this.running;
    this.advanceInterpreter(dt);
    this.advanceParallels(dt);
    this.moveEvents(dt);
    if (!this.running) this.tryAutorun();
    if (
      !this.running &&
      !runningAtStart &&
      !this.player.isMoving &&
      !this.playerOnRoute &&
      input.justPressed('confirm')
    ) {
      this.tryAction();
    }
    const playerRoute = this.routes.get('player');
    if (playerRoute) {
      playerRoute.update(dt, this.player, this.passability, this.surroundings, this.moveHooks);
      if (playerRoute.isDone(this.player)) this.endPlayerRoute();
    } else {
      this.player.update(
        dt,
        this.passability,
        () =>
          this.running || runningAtStart || this.pendingEncounter !== null
            ? null
            : input.heldDirection(),
        this.moveHooks,
      );
    }
    // An event triggered during this step runs up to its first pause right
    // away, so its first message shows without a one-step delay.
    if (this.running && this.running !== runningAtStart) this.advanceInterpreter(0);
  }
}
