// How battles start and end on the map: random encounters and event
// battles, fades in and out, running the battle screen, handing the outcome
// back to the event, and game over. Free of PixiJS so it can be tested in
// Node; the game supplies hooks that build and remove the battle view.
import {
  Battle,
  type BattleOutcome,
  type DatabaseIndex,
  type InputState,
  type InterpreterRequest,
  type World,
} from '@freequest/core';
import { BattleController } from './battle-controller.js';

type BattleRequest = Extract<InterpreterRequest, { type: 'battle' }>;

/** What started the battle: a random encounter, or an event's battle command. */
type Source =
  { readonly kind: 'encounter' } | { readonly kind: 'event'; readonly request: BattleRequest };

type Phase =
  | { kind: 'idle' }
  | { kind: 'enter'; troop: string; source: Source; elapsed: number }
  | { kind: 'fight'; source: Source; elapsed: number }
  | { kind: 'leave'; source: Source; outcome: BattleOutcome; elapsed: number }
  | { kind: 'return'; elapsed: number }
  | { kind: 'over' };

export interface BattleFlowHooks {
  /** Load whatever the battle screen needs for a troop (e.g. enemy images). */
  prepare(troop: string): Promise<void>;
  /** Show the battle screen (called while the screen is black). */
  begin(battle: Battle, controller: BattleController): void;
  /** Remove the battle screen (called while the screen is black). */
  end(): void;
  /** The party lost a battle it wasn't allowed to lose. */
  gameOver(): void;
}

export interface BattleFlowOptions {
  /** Seconds for each fade. 0 switches instantly. */
  fadeSeconds?: number;
  random?: () => number;
  /** Seconds per battle log line. */
  lineSeconds?: number;
}

export class BattleFlow {
  private phase: Phase = { kind: 'idle' };
  private ready = false;
  private failed: unknown = null;
  private current: BattleController | null = null;
  private readonly fadeSeconds: number;
  private readonly random: () => number;
  private readonly lineSeconds: number | undefined;

  constructor(
    private readonly db: DatabaseIndex,
    private readonly hooks: BattleFlowHooks,
    options: BattleFlowOptions = {},
  ) {
    this.fadeSeconds = options.fadeSeconds ?? 0.3;
    this.random = options.random ?? Math.random;
    this.lineSeconds = options.lineSeconds;
  }

  /** True from the first fade until back on the map. The map should not step meanwhile. */
  get active(): boolean {
    return this.phase.kind !== 'idle';
  }

  /** True after a lost battle that ends the game. */
  get isGameOver(): boolean {
    return this.phase.kind === 'over';
  }

  /** The running battle screen's controller, if any. */
  get controller(): BattleController | null {
    return this.current;
  }

  /** Opacity of the black overlay, 0 to 1. */
  get fade(): number {
    const p = this.phase;
    const t = (elapsed: number) =>
      this.fadeSeconds > 0 ? Math.min(1, elapsed / this.fadeSeconds) : 1;
    switch (p.kind) {
      case 'enter':
      case 'leave':
        return t(p.elapsed);
      case 'fight':
      case 'return':
        return 1 - t(p.elapsed);
      case 'over':
        return 1;
      default:
        return 0;
    }
  }

  /** Back to idle (e.g. after a new game starts from the game-over screen). */
  reset(): void {
    this.phase = { kind: 'idle' };
    this.current = null;
  }

  /** Call once per fixed logic step, before the world steps. */
  update(dt: number, world: World, input: InputState): void {
    const p = this.phase;
    switch (p.kind) {
      case 'idle': {
        const pending = world.interpreter?.pending;
        if (pending?.type === 'battle')
          return this.start(pending.troop, { kind: 'event', request: pending });
        const troop = world.takeEncounter();
        if (troop !== null) this.start(troop, { kind: 'encounter' });
        return;
      }
      case 'enter':
        p.elapsed += dt;
        if (p.elapsed < this.fadeSeconds) return;
        if (this.failed !== null) {
          // Couldn't load the battle: skip it rather than freeze the game. It
          // counts as an escape, or (for battles that can't be escaped) as a
          // win without rewards so the event can carry on.
          console.error(`Battle with troop "${p.troop}" failed to start`, this.failed);
          const escapable = p.source.kind === 'encounter' || p.source.request.canEscape;
          this.phase = {
            kind: 'leave',
            source: p.source,
            outcome: escapable ? 'escape' : 'win',
            elapsed: this.fadeSeconds,
          };
          return;
        }
        if (!this.ready) return; // hold on black until loaded
        this.beginBattle(world, p.troop, p.source);
        return;
      case 'fight': {
        p.elapsed += dt;
        const controller = this.current;
        if (!controller) return;
        controller.update(dt, input);
        if (controller.outcome)
          this.phase = { kind: 'leave', source: p.source, outcome: controller.outcome, elapsed: 0 };
        return;
      }
      case 'leave':
        p.elapsed += dt;
        if (p.elapsed < this.fadeSeconds) return;
        return this.finish(world, p.source, p.outcome);
      case 'return':
        p.elapsed += dt;
        if (p.elapsed >= this.fadeSeconds) this.phase = { kind: 'idle' };
        return;
      case 'over':
        return;
    }
  }

  private start(troop: string, source: Source): void {
    this.phase = { kind: 'enter', troop, source, elapsed: 0 };
    this.ready = false;
    this.failed = null;
    this.hooks.prepare(troop).then(
      () => (this.ready = true),
      (error: unknown) => (this.failed = error ?? new Error('unknown error')),
    );
  }

  private beginBattle(world: World, troop: string, source: Source): void {
    const battle = new Battle({
      db: this.db,
      party: world.party,
      troop,
      state: world.state,
      // Random encounters can always be run from; events decide for themselves.
      canEscape: source.kind === 'encounter' || source.request.canEscape,
      random: this.random,
    });
    this.current = new BattleController(
      battle,
      this.db,
      this.lineSeconds === undefined ? {} : { lineSeconds: this.lineSeconds },
    );
    this.hooks.begin(battle, this.current);
    this.phase = { kind: 'fight', source, elapsed: 0 };
  }

  private finish(world: World, source: Source, outcome: BattleOutcome): void {
    this.hooks.end();
    this.current = null;
    const allowedToLose = source.kind === 'event' && source.request.canLose;
    if (outcome === 'lose' && !allowedToLose) {
      this.phase = { kind: 'over' };
      this.hooks.gameOver();
      return;
    }
    if (source.kind === 'event' && world.interpreter?.pending === source.request) {
      world.interpreter.finishBattle(outcome);
    }
    this.phase = { kind: 'return', elapsed: 0 };
  }
}
