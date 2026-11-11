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
  type InputState,
  canTarget,
} from '@freequest/core';
import type { ItemEntry, SkillEntry } from '@freequest/schema';
import { withIcon } from './icons.js';
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

export type BattleStage = 'party' | 'actor' | 'skill' | 'item' | 'target' | 'playback' | 'finished';

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
}

interface Line {
  readonly text: string;
  readonly event: BattleEvent | null;
  /** Results stay up until confirmed rather than advancing on a timer. */
  readonly hold: boolean;
}

type Pending = { kind: 'skill'; entry: SkillEntry } | { kind: 'item'; entry: ItemEntry };

export interface BattleControllerOptions {
  /** Seconds each log line stays up before advancing on its own. */
  lineSeconds?: number;
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
  private finalOutcome: BattleOutcome | null = null;
  private readonly lineSeconds: number;

  constructor(
    private readonly battle: Battle,
    private readonly db: DatabaseIndex,
    options: BattleControllerOptions = {},
  ) {
    this.lineSeconds = options.lineSeconds ?? 0.9;
    const names = battle.enemies.map((e) => e.name);
    const who =
      names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    this.queue.push({
      text: `${who} ${names.length === 1 ? 'appears' : 'appear'}!`,
      event: null,
      hold: false,
    });
    if (battle.phase === 'lost') this.enqueue([{ type: 'defeat' }]);
  }

  get state(): BattleUiState {
    const line = this.stage === 'playback' ? (this.queue[0] ?? null) : null;
    return {
      stage: this.stage,
      menu: this.menu(),
      actor: this.currentActor(),
      target: this.stage === 'target' ? (this.targets[this.cursor] ?? null) : null,
      line: line?.text ?? null,
      event: line?.event ?? null,
      outcome: this.finalOutcome,
    };
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
    switch (this.stage) {
      case 'playback':
        return this.updatePlayback(dt, input);
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
      const hold =
        event.type === 'victory' ||
        event.type === 'defeat' ||
        (event.type === 'escape' && event.success);
      for (const text of describeEvent(event, this.db)) this.queue.push({ text, event, hold });
    }
    this.stage = 'playback';
    this.lineTime = 0;
  }

  private updatePlayback(dt: number, input: InputState): void {
    const line = this.queue[0];
    if (!line) {
      this.afterPlayback();
      return;
    }
    this.lineTime += dt;
    const confirmed = input.justPressed('confirm');
    if (confirmed || (!line.hold && this.lineTime >= this.lineSeconds)) {
      this.queue.shift();
      this.lineTime = 0;
      if (this.queue.length === 0) this.afterPlayback();
    }
  }

  private afterPlayback(): void {
    const phase = this.battle.phase;
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
          detail: s.mpCost > 0 ? `${s.mpCost} MP` : '',
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
        else this.enqueue(this.battle.tryEscape());
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
      this.enqueue(this.battle.runTurn());
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
      this.enqueue(this.battle.runTurn());
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
