import type { Command, GameMap, Manifest, Tileset } from '@freequest/schema';
import { CollisionMap, type Passability } from './collision.js';
import { DIRECTION_DELTA, type Direction } from './direction.js';
import { EventInstance } from './events.js';
import { GameState } from './game-state.js';
import { GridMover, type MoveHooks } from './grid-mover.js';
import type { InputState } from './input.js';
import { Interpreter } from './interpreter.js';

export interface WorldOptions {
  manifest: Manifest;
  map: GameMap;
  tileset: Tileset;
  /** Shared across maps. Defaults to a fresh state for the manifest. */
  state?: GameState;
}

const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  up: 'down',
  left: 'right',
  right: 'left',
};

/** The live game state for one map. Advanced only through `step`. */
export class World {
  readonly map: GameMap;
  readonly tileset: Tileset;
  readonly collision: CollisionMap;
  readonly player: GridMover;
  readonly state: GameState;
  readonly events: readonly EventInstance[];
  /** Tile collision plus events that block. What characters move against. */
  readonly passability: Passability;

  private running: Interpreter | null = null;
  private runningEvent: EventInstance | null = null;
  private seenStateVersion: number;

  constructor({ manifest, map, tileset, state }: WorldOptions) {
    if (map.tileset !== tileset.id) {
      throw new Error(`map "${map.id}" uses tileset "${map.tileset}", got "${tileset.id}"`);
    }
    this.map = map;
    this.tileset = tileset;
    this.state = state ?? new GameState(manifest);
    this.collision = CollisionMap.fromMap(map, tileset);
    const { start } = manifest;
    if (!this.collision.inBounds(start.x, start.y)) {
      throw new Error(`start position (${start.x}, ${start.y}) is outside map "${map.id}"`);
    }
    this.player = new GridMover({
      x: start.x,
      y: start.y,
      direction: start.direction,
      speed: manifest.player.speed,
    });
    this.events = map.events.map((e) => new EventInstance(e, this.state));
    this.seenStateVersion = this.state.version;
    this.passability = {
      width: map.width,
      height: map.height,
      isPassable: (x, y) => this.collision.isPassable(x, y) && !this.blockingEventAt(x, y),
    };
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
    this.running = new Interpreter(commands, this.state);
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

  private refreshEvents(): void {
    if (this.state.version === this.seenStateVersion) return;
    this.seenStateVersion = this.state.version;
    for (const event of this.events) event.refresh(this.state, event === this.runningEvent);
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
    // Stepping onto a touch event that you can walk over.
    arrived: (x, y) => {
      this.triggerAt(x, y, (e) => e.page?.trigger === 'touch' && !e.blocks);
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
      () => (this.running || runningAtStart ? null : input.heldDirection()),
      this.moveHooks,
    );
    // An event triggered during this step runs up to its first pause right
    // away, so its first message shows without a one-step delay.
    if (this.running && this.running !== runningAtStart) this.advanceInterpreter(0);
  }
}
