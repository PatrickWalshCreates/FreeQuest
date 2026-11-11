import {
  type Command,
  type GameMap,
  type Manifest,
  SAVE_FORMAT_VERSION,
  type SaveFile,
  type Tileset,
  emptyDatabase,
} from '@freequest/schema';
import { CollisionMap, type Passability } from './collision.js';
import { DatabaseIndex } from './database.js';
import { DIRECTIONS, DIRECTION_DELTA, type Direction } from './direction.js';
import { EventInstance } from './events.js';
import { type AudioSink, type EventContext, GameState } from './game-state.js';
import { GridMover, type MoveHooks } from './grid-mover.js';
import type { InputState } from './input.js';
import { Interpreter } from './interpreter.js';
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
  /** Interpreters of parallel pages, running alongside play (one per event). */
  private readonly parallels = new Map<EventInstance, Interpreter>();
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
    // The old map's parallel events stop; the new map's start on the next step.
    this.parallels.clear();
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
    return new World({
      manifest: options.manifest,
      map: options.map,
      tileset: options.tileset,
      database: options.database,
      state,
      party,
      position: { x: save.x, y: save.y, direction: save.direction },
      ...(options.random ? { random: options.random } : {}),
    });
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
    this.running = new Interpreter(commands, this.eventContext);
    this.runningEvent = source;
    return this.running;
  }

  /** Events whose parallel pages are running in the background right now (for tests and debugging). */
  get parallelEvents(): readonly EventInstance[] {
    return [...this.parallels.keys()];
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
      const interpreter = new Interpreter(page.commands, this.eventContext);
      interpreter.update(dt);
      if (!interpreter.isDone) this.parallels.set(event, interpreter);
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
      const movement = event.page?.movement;
      const mover = event.mover;
      if (!movement && !mover.isMoving) continue;
      if (movement) mover.speed = movement.speed;
      const passability = this.passabilityFor(event);
      const still = event === this.runningEvent || !movement;
      let wanted: Direction | null = null;
      if (!mover.isMoving && !still) {
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
        {
          bumped: (x, y) => {
            const page = event.page;
            if (page?.trigger !== 'touch' || !event.blocks || this.running) return;
            if (x === this.player.x && y === this.player.y) this.run(page.commands, event);
          },
        },
      );
    }
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

  /** What event conditions and commands see: switches, variables and the party. */
  get eventContext(): EventContext {
    return { state: this.state, party: this.party, audio: this.audio };
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
      if (event?.page?.graphic) event.direction = OPPOSITE[direction];
      return;
    }
    this.triggerAt(x, y, (e) => isAction(e) && !e.blocks);
  }

  private tryAutorun(): void {
    const event = this.events.find((e) => e.page?.trigger === 'autorun');
    if (event?.page) this.run(event.page.commands, event);
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
      this.running = null;
      this.runningEvent = null;
    }
  }

  /** Advance the simulation by one fixed step of `dt` seconds. */
  step(dt: number, input: InputState): void {
    this.refreshEvents();
    // An event running at the start of this step owns this step's input, so
    // the confirm press that closes its last message can't start a new one.
    const runningAtStart = this.running;
    this.advanceInterpreter(dt);
    this.advanceParallels(dt);
    this.moveEvents(dt);
    if (!this.running) this.tryAutorun();
    if (!this.running && !runningAtStart && !this.player.isMoving && input.justPressed('confirm')) {
      this.tryAction();
    }
    this.player.update(
      dt,
      this.passability,
      () =>
        this.running || runningAtStart || this.pendingEncounter !== null
          ? null
          : input.heldDirection(),
      this.moveHooks,
    );
    // An event triggered during this step runs up to its first pause right
    // away, so its first message shows without a one-step delay.
    if (this.running && this.running !== runningAtStart) this.advanceInterpreter(0);
  }
}
