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
import { DIRECTION_DELTA, type Direction } from './direction.js';
import { EventInstance } from './events.js';
import { type EventContext, GameState } from './game-state.js';
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
  private seenVersion: string;
  private readonly random: () => number;
  /** Steps left until the next random encounter on this map. */
  private encounterCountdown = Infinity;
  private pendingEncounter: string | null = null;

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
    this.player.placeAt(x, y);
    this.pendingEncounter = null;
    this.encounterCountdown = this.rollEncounterSteps();
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
   * running: saving happens from the menu.
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

  /** Present events (with an active page) at a tile, in map order. */
  eventsAt(x: number, y: number): EventInstance[] {
    return this.events.filter((e) => e.page !== null && e.x === x && e.y === y);
  }

  private blockingEventAt(x: number, y: number): boolean {
    return this.events.some((e) => e.blocks && e.x === x && e.y === y);
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
    return { state: this.state, party: this.party };
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
