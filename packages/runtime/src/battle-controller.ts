// Battle screen logic: menus, target selection and log playback over a core
// Battle. Free of PixiJS so it can be tested in Node; `battle-view.ts` draws
// whatever state this holds.
import {
  type Actor,
  type Battle,
  type BattleEvent,
  type BattleOutcome,
  type BattlePhase,
  type Battler,
  type DatabaseIndex,
  type EventContext,
  type InputState,
  Interpreter,
  animationSounds,
  canTarget,
} from '@freequest/core';
import {
  type AnimationEntry,
  type Command,
  type ItemEntry,
  type SkillEntry,
  animationSeconds,
} from '@freequest/schema';
import { withIcon } from './icons.js';
import { TURN_PAUSE_SECONDS } from './battle-feel.js';
import { describeEvent } from './battle-text.js';

export interface MenuOption {
  readonly label: string;
  /** Right-aligned extra text, e.g. MP cost or item count. */
  readonly detail?: string;
  readonly enabled: boolean;
  /** Index into the game's iconset, drawn before the label. */
  readonly icon?: number;
}

export interface BattleMenu {
  readonly title: string;
  readonly options: readonly MenuOption[];
  readonly cursor: number;
}

export type BattleStage =
  | 'party'
  | 'actor'
  | 'skill'
  | 'item'
  | 'target'
  | 'playback'
  /** A troop's battle event or a common event is running (messages show in the message box). */
  | 'event'
  | 'finished';

/** Everything the view needs to draw one frame. */
export interface BattleUiState {
  readonly stage: BattleStage;
  readonly menu: BattleMenu | null;
  /** The actor being given a command. */
  readonly actor: Actor | null;
  /** Highlighted target while choosing one. */
  readonly target: Battler | null;
  /** The log line being shown during playback. */
  readonly line: string | null;
  /** The event behind the current line (for hit flashes and damage numbers). */
  readonly event: BattleEvent | null;
  readonly outcome: BattleOutcome | null;
  /** An animation playing on a battler: its entry, target and seconds in (or null). */
  readonly animation: BattleAnimation | null;
  /** Seconds since the battle opened (the enemies' entrance). */
  readonly opened: number;
  /** Who is acting in the line shown now, and for how long it has been up (or null). */
  readonly acting: { readonly battler: Battler; readonly elapsed: number } | null;
}

export interface BattleAnimation {
  readonly entry: AnimationEntry;
  readonly target: Battler;
  readonly elapsed: number;
}

/**
 * What playback works through: log lines, commands to run (a troop's battle
 * event, a common event), and points where the troop's events are checked.
 */
type Line =
  | {
      readonly kind: 'line';
      readonly text: string;
      readonly event: BattleEvent | null;
      /** Results stay up until confirmed rather than advancing on a timer. */
      readonly hold: boolean;
      /** The animation that plays while this line is up (a hit's first line). */
      readonly animation?: AnimationEntry;
    }
  | { readonly kind: 'run'; readonly commands: readonly Command[] }
  /** A moment of quiet (as a turn starts), with a sound at its start. */
  | { readonly kind: 'pause'; readonly seconds: number; readonly sound: string | null }
  | { readonly kind: 'check'; readonly moment: 'turnStart' | 'turnEnd' };

type Pending = { kind: 'skill'; entry: SkillEntry } | { kind: 'item'; entry: ItemEntry };

export interface BattleControllerOptions {
  /** Seconds each log line stays up before advancing on its own. */
  lineSeconds?: number;
  /** What battle events and common events run with (the game's state and party). Without it they're skipped. */
  events?: EventContext;
}

const ACTOR_COMMANDS = ['Attack', 'Skill', 'Guard', 'Item'] as const;

export class BattleController {
  private stage: BattleStage = 'playback';
  private cursor = 0;
  private commandable: Actor[] = [];
  private actorIndex = 0;
  private pending: Pending | null = null;
  /** Where cancel goes from target selection. */
  private targetReturn: BattleStage = 'actor';
  private targets: Battler[] = [];
  private queue: Line[] = [];
  private lineTime = 0;
  /** Seconds since the battle opened. */
  private time = 0;
  /** Sounds due since the last `drainSounds()`: animations' and each turn's start. */
  private readonly sounds: string[] = [];
  private finalOutcome: BattleOutcome | null = null;
  private readonly lineSeconds: number;
  private readonly events: EventContext | null;
  /** The battle event or common event running now. */
  private running: Interpreter | null = null;
  /** The turn whose start the troop's events were last checked for. */
  private checkedTurn = -1;

  constructor(
    private readonly battle: Battle,
    private readonly db: DatabaseIndex,
    options: BattleControllerOptions = {},
  ) {
    this.lineSeconds = options.lineSeconds ?? 0.9;
    this.events = options.events ?? null;
    const names = battle.enemies.map((e) => e.name);
    const who =
      names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    this.queue.push({
      kind: 'line',
      text: `${who} ${names.length === 1 ? 'appears' : 'appear'}!`,
      event: null,
      hold: false,
    });
    if (battle.phase === 'lost') this.enqueue([{ type: 'defeat' }]);
  }

  get state(): BattleUiState {
    const front = this.stage === 'playback' ? (this.queue[0] ?? null) : null;
    const line = front?.kind === 'line' ? front : null;
    return {
      stage: this.stage,
      menu: this.menu(),
      actor: this.currentActor(),
      target: this.stage === 'target' ? (this.targets[this.cursor] ?? null) : null,
      line: line?.text ?? null,
      event: line?.event ?? null,
      outcome: this.finalOutcome,
      animation:
        line?.animation && line.event?.type === 'hit'
          ? { entry: line.animation, target: line.event.result.target, elapsed: this.lineTime }
          : null,
      opened: this.time,
      acting:
        line?.event?.type === 'action'
          ? { battler: line.event.user, elapsed: this.lineTime }
          : line?.event?.type === 'counter'
            ? { battler: line.event.battler, elapsed: this.lineTime }
            : null,
    };
  }

  /** The battle event (or common event) running, whose messages and choices the game shows. */
  get eventInterpreter(): Interpreter | null {
    return this.running;
  }

  /** Sounds due since the last call (animations', a turn's start), in order. */
  drainSounds(): string[] {
    return this.sounds.splice(0);
  }

  /** The underlying battle's phase (e.g. 'won' while the victory lines play). */
  get battlePhase(): BattlePhase {
    return this.battle.phase;
  }

  /** The battle's result once everything has been shown, else null. */
  get outcome(): BattleOutcome | null {
    return this.finalOutcome;
  }

  /** Call once per fixed logic step. */
  update(dt: number, input: InputState): void {
    this.time += dt;
    switch (this.stage) {
      case 'playback':
        return this.updatePlayback(dt, input);
      case 'event':
        return this.updateEvent(dt);
      case 'target':
        return this.updateTarget(input);
      case 'finished':
        return;
      default:
        return this.updateMenu(input);
    }
  }

  // Playback ----------------------------------------------------------------

  private enqueue(events: readonly BattleEvent[]): void {
    for (const event of events) {
      if (event.type === 'turnStart') {
        this.queue.push({
          kind: 'pause',
          seconds: TURN_PAUSE_SECONDS,
          sound: this.db.system.audio?.sounds?.turnStart ?? null,
        });
        continue;
      }
      const hold =
        event.type === 'victory' ||
        event.type === 'defeat' ||
        (event.type === 'escape' && event.success);
      const animation =
        event.type === 'hit' && event.animation !== null && !event.result.missed
          ? this.db.animations.find(event.animation)
          : undefined;
      describeEvent(event, this.db).forEach((text, i) =>
        this.queue.push({
          kind: 'line',
          text,
          event,
          hold,
          ...(i === 0 && animation ? { animation } : {}),
        }),
      );
      if (event.type === 'commonEvent') {
        this.queue.push({ kind: 'run', commands: this.db.commonEvents.get(event.common).commands });
      }
    }
    this.stage = 'playback';
    this.lineTime = 0;
  }

  /** A turn's events, then the troop's turn-end events. */
  private playTurn(events: readonly BattleEvent[]): void {
    this.enqueue(events);
    this.queue.push({ kind: 'check', moment: 'turnEnd' });
  }

  /** Run a battle event's commands until they finish; their messages and choices wait for the player. */
  private updateEvent(dt: number): void {
    const running = this.running;
    if (!running) {
      this.stage = 'playback';
      return;
    }
    running.update(dt);
    const request = running.pending;
    // Only messages and choices make sense here (the checks keep the rest out of battle events).
    if (request && request.type !== 'message' && request.type !== 'choice') {
      if (request.type === 'battle') running.finishBattle('win');
      else if (request.type !== 'gameOver' && request.type !== 'title') running.continue();
    }
    if (!running.isDone && request?.type !== 'gameOver' && request?.type !== 'title') return;
    this.running = null;
    this.queue.shift();
    // The event may have ended the battle (everyone knocked out, say).
    this.queue.unshift(...this.linesFor(this.battle.checkOutcome()));
    this.stage = 'playback';
    this.lineTime = 0;
  }

  private linesFor(events: readonly BattleEvent[]): Line[] {
    const saved = this.queue;
    this.queue = [];
    this.enqueue(events);
    const lines = this.queue;
    this.queue = saved;
    return lines;
  }

  private updatePlayback(dt: number, input: InputState): void {
    const line = this.queue[0];
    if (!line) {
      this.afterPlayback();
      return;
    }
    if (line.kind === 'check') {
      this.queue.shift();
      const due = this.battle.dueEvents(line.moment);
      this.queue.unshift(...due.map((commands) => ({ kind: 'run' as const, commands })));
      if (this.queue.length === 0) this.afterPlayback();
      return;
    }
    if (line.kind === 'run') {
      if (!this.events) {
        this.queue.shift();
        if (this.queue.length === 0) this.afterPlayback();
        return;
      }
      this.running = new Interpreter(line.commands, { ...this.events, self: null });
      this.stage = 'event';
      this.updateEvent(dt);
      return;
    }
    if (line.kind === 'pause') {
      if (this.lineTime === 0 && line.sound) this.sounds.push(line.sound);
      this.lineTime += dt;
      if (this.lineTime >= line.seconds) {
        this.queue.shift();
        this.lineTime = 0;
        if (this.queue.length === 0) this.afterPlayback();
      }
      return;
    }
    const from = this.lineTime;
    this.lineTime += dt;
    // A line with an animation stays up until it has played (confirm still skips it).
    const animation = line.animation;
    if (animation) this.sounds.push(...animationSounds(animation, from, this.lineTime));
    const seconds = Math.max(this.lineSeconds, animation ? animationSeconds(animation) : 0);
    const confirmed = input.justPressed('confirm');
    if (confirmed || (!line.hold && this.lineTime >= seconds)) {
      this.queue.shift();
      this.lineTime = 0;
      if (this.queue.length === 0) this.afterPlayback();
    }
  }

  private afterPlayback(): void {
    const phase = this.battle.phase;
    // Before each turn's commands (also the first), the troop's turn-start events.
    if (phase === 'input' && this.checkedTurn !== this.battle.turn) {
      this.checkedTurn = this.battle.turn;
      const due = this.battle.dueEvents('turnStart');
      if (due.length > 0) {
        this.queue.push(...due.map((commands) => ({ kind: 'run' as const, commands })));
        this.stage = 'playback';
        return;
      }
    }
    if (phase === 'input') {
      this.stage = 'party';
      this.cursor = 0;
      return;
    }
    this.stage = 'finished';
    this.finalOutcome = phase === 'won' ? 'win' : phase === 'escaped' ? 'escape' : 'lose';
  }

  // Menus -------------------------------------------------------------------

  private currentActor(): Actor | null {
    return this.stage === 'party' || this.stage === 'playback' || this.stage === 'finished'
      ? null
      : (this.commandable[this.actorIndex] ?? null);
  }

  private menu(): BattleMenu | null {
    const options = this.menuOptions();
    if (!options) return null;
    const title =
      this.stage === 'party'
        ? 'Party'
        : this.stage === 'actor'
          ? (this.currentActor()?.name ?? '')
          : this.stage === 'skill'
            ? 'Skills'
            : 'Items';
    return { title, options, cursor: this.cursor };
  }

  private menuOptions(): MenuOption[] | null {
    const actor = this.currentActor();
    switch (this.stage) {
      case 'party':
        return [
          { label: 'Fight', enabled: true },
          { label: 'Escape', enabled: this.battle.canEscape },
        ];
      case 'actor':
        return ACTOR_COMMANDS.map((label) => ({
          label,
          enabled:
            (label === 'Attack' && this.db.system.attackSkill !== undefined) ||
            (label === 'Guard' && this.db.system.guardSkill !== undefined) ||
            (label === 'Skill' && this.skillEntries().length > 0) ||
            (label === 'Item' && this.itemEntries().length > 0),
        }));
      case 'skill':
        return this.skillEntries().map((s) => ({
          label: s.name,
          ...withIcon(s.icon),
          detail: [
            s.mpCost > 0 ? `${s.mpCost} MP` : '',
            (s.tpCost ?? 0) > 0 ? `${s.tpCost} TP` : '',
          ]
            .filter(Boolean)
            .join(' '),
          enabled:
            actor !== null &&
            this.battle.actionProblem(actor, { kind: 'skill', skill: s.id }) === null,
        }));
      case 'item':
        return this.itemEntries().map(({ entry, count }) => ({
          label: entry.name,
          ...withIcon(entry.icon),
          detail: `×${count}`,
          enabled:
            actor !== null &&
            this.battle.actionProblem(actor, { kind: 'item', item: entry.id }) === null,
        }));
      default:
        return null;
    }
  }

  private skillEntries(): SkillEntry[] {
    const actor = this.currentActor();
    if (!actor) return [];
    return actor.skills
      .map((id) => this.db.skills.get(id))
      .filter((s) => s.occasion === 'battle' || s.occasion === 'always');
  }

  /** Carried items usable in battle, in database order. */
  private itemEntries(): { entry: ItemEntry; count: number }[] {
    return this.db.items.all
      .filter((entry) => entry.occasion === 'battle' || entry.occasion === 'always')
      .map((entry) => ({ entry, count: this.battle.itemCount(entry.id) }))
      .filter((e) => e.count > 0);
  }

  private updateMenu(input: InputState): void {
    const options = this.menuOptions() ?? [];
    const count = options.length;
    if (count > 0 && input.justPressed('down')) this.cursor = (this.cursor + 1) % count;
    if (count > 0 && input.justPressed('up')) this.cursor = (this.cursor - 1 + count) % count;
    if (input.justPressed('cancel')) return this.back();
    if (!input.justPressed('confirm')) return;
    const option = options[this.cursor];
    if (!option?.enabled) return;

    switch (this.stage) {
      case 'party':
        if (option.label === 'Fight') this.beginCommands();
        else this.playTurn(this.battle.tryEscape());
        return;
      case 'actor':
        return this.chooseCommand(option.label);
      case 'skill': {
        const skill = this.skillEntries()[this.cursor];
        if (skill) this.chooseUsable({ kind: 'skill', entry: skill }, 'skill');
        return;
      }
      case 'item': {
        const item = this.itemEntries()[this.cursor];
        if (item) this.chooseUsable({ kind: 'item', entry: item.entry }, 'item');
        return;
      }
    }
  }

  private beginCommands(): void {
    this.commandable = this.battle.actorsToCommand();
    this.actorIndex = 0;
    if (this.commandable.length === 0) {
      this.playTurn(this.battle.runTurn());
      return;
    }
    this.stage = 'actor';
    this.cursor = 0;
  }

  private chooseCommand(label: string): void {
    const { attackSkill, guardSkill } = this.db.system;
    if (label === 'Attack' && attackSkill) {
      this.chooseUsable({ kind: 'skill', entry: this.db.skills.get(attackSkill) }, 'actor');
    } else if (label === 'Guard' && guardSkill) {
      this.chooseUsable({ kind: 'skill', entry: this.db.skills.get(guardSkill) }, 'actor');
    } else {
      this.stage = label === 'Skill' ? 'skill' : 'item';
      this.cursor = 0;
    }
  }

  /** Pick a target if the scope needs one, otherwise commit the action. */
  private chooseUsable(pending: Pending, from: BattleStage): void {
    const scope = pending.entry.target;
    if ((scope.side === 'ally' || scope.side === 'enemy') && scope.select === 'one') {
      const pool: readonly Battler[] =
        scope.side === 'enemy' ? this.battle.livingEnemies : this.battle.actors;
      const candidates = pool.filter((b) => canTarget(scope, b));
      if (candidates.length === 0) return;
      this.pending = pending;
      this.targets = candidates;
      this.targetReturn = from;
      this.stage = 'target';
      this.cursor = 0;
      return;
    }
    this.commit(pending, undefined);
  }

  private updateTarget(input: InputState): void {
    const count = this.targets.length;
    if (input.justPressed('right') || input.justPressed('down'))
      this.cursor = (this.cursor + 1) % count;
    if (input.justPressed('left') || input.justPressed('up'))
      this.cursor = (this.cursor - 1 + count) % count;
    if (input.justPressed('cancel')) {
      this.stage = this.targetReturn;
      this.cursor = 0;
      this.pending = null;
      return;
    }
    if (input.justPressed('confirm') && this.pending) {
      this.commit(this.pending, this.targets[this.cursor]);
    }
  }

  private commit(pending: Pending, target: Battler | undefined): void {
    const actor = this.commandable[this.actorIndex];
    if (!actor) return;
    const withTarget = target ? { target } : {};
    this.battle.setAction(
      actor,
      pending.kind === 'skill'
        ? { kind: 'skill', skill: pending.entry.id, ...withTarget }
        : { kind: 'item', item: pending.entry.id, ...withTarget },
    );
    this.pending = null;
    this.actorIndex++;
    if (this.actorIndex >= this.commandable.length) {
      this.playTurn(this.battle.runTurn());
    } else {
      this.stage = 'actor';
      this.cursor = 0;
    }
  }

  /** Cancel: lists → actor menu; actor menu → previous actor (undoing their choice) → party menu. */
  private back(): void {
    if (this.stage === 'skill' || this.stage === 'item') {
      this.stage = 'actor';
      this.cursor = 0;
      return;
    }
    if (this.stage !== 'actor') return;
    if (this.actorIndex === 0) {
      this.stage = 'party';
      this.cursor = 0;
      return;
    }
    this.actorIndex--;
    const previous = this.commandable[this.actorIndex];
    if (previous) this.battle.clearAction(previous);
    this.cursor = 0;
  }
}
