import type { Command, CommandOf, Direction, Operand } from '@freequest/schema';
import {
  type EventContext,
  type GameState,
  evaluateConditions,
  requireParty,
  toEventContext,
} from './game-state.js';
import type { Party } from './party.js';

/**
 * Something the interpreter needs from outside core before it can continue.
 * The runtime presents it (message box, choice window, map change) and
 * answers with `continue()` or `choose()`/`cancel()`.
 */
export type InterpreterRequest =
  | { type: 'message'; speaker: string | null; text: string }
  | { type: 'choice'; options: readonly string[]; cancel: number | null }
  | { type: 'transfer'; map: string; x: number; y: number; direction: Direction | null }
  | { type: 'battle'; troop: string; canEscape: boolean; canLose: boolean };

export type BattleOutcome = 'win' | 'escape' | 'lose';

/** Commands executed in one update before we assume a runaway loop. */
const MAX_COMMANDS_PER_UPDATE = 10_000;

/** Slack for float rounding, so a wait doesn't overrun by a whole step (e.g. 0.3 + 0.3 - 0.5 < 0.1). */
const TIME_EPSILON = 1e-9;

interface Frame {
  readonly commands: readonly Command[];
  index: number;
}

/**
 * Runs an event's command tree. Execution state is an explicit stack of
 * (command list, index) frames rather than a JS generator, so it can be
 * serialized for save/load later.
 *
 * Drive it with `update(dt)` once per fixed logic step. It runs commands
 * until it finishes, starts a timed wait, or issues a request.
 */
export class Interpreter {
  private readonly stack: Frame[];
  private readonly context: EventContext;
  private request: InterpreterRequest | null = null;
  private choiceCommand: CommandOf<'choice'> | null = null;
  private battleCommand: CommandOf<'battle'> | null = null;
  private waitRemaining = 0;

  constructor(commands: readonly Command[], context: EventContext | GameState) {
    this.stack = [{ commands, index: 0 }];
    this.context = toEventContext(context);
  }

  /** The request awaiting an answer, if any. */
  get pending(): InterpreterRequest | null {
    return this.request;
  }

  get isDone(): boolean {
    return this.request === null && this.waitRemaining <= 0 && this.peek() === null;
  }

  /** Advance by `dt` seconds. Does nothing while a request is pending. */
  update(dt: number): void {
    let time = dt;
    let executed = 0;
    while (this.request === null) {
      if (this.waitRemaining > 0) {
        if (time < this.waitRemaining - TIME_EPSILON) {
          this.waitRemaining -= time;
          return;
        }
        time = Math.max(time - this.waitRemaining, 0);
        this.waitRemaining = 0;
      }
      const command = this.next();
      if (command === null) return;
      if (++executed > MAX_COMMANDS_PER_UPDATE) {
        throw new Error(`interpreter ran ${MAX_COMMANDS_PER_UPDATE} commands without pausing`);
      }
      this.execute(command);
    }
  }

  /** Answer a pending message or transfer request. */
  continue(): void {
    const request = this.request;
    if (request === null || request.type === 'choice' || request.type === 'battle') {
      throw new Error(
        `continue() called while ${request ? `a ${request.type}` : 'nothing'} is pending`,
      );
    }
    this.request = null;
  }

  /**
   * Answer a pending battle with its outcome; the matching branch runs next.
   * A loss the event doesn't allow (`canLose: false`) is game over and must
   * be handled by the host instead.
   */
  finishBattle(outcome: BattleOutcome): void {
    const command = this.battleCommand;
    if (this.request?.type !== 'battle' || command === null) {
      throw new Error('finishBattle() called while no battle is pending');
    }
    if (outcome === 'escape' && !command.canEscape)
      throw new Error('this battle cannot be escaped');
    if (outcome === 'lose' && !command.canLose) throw new Error('this battle cannot be lost');
    this.request = null;
    this.battleCommand = null;
    const branch = { win: command.onWin, escape: command.onEscape, lose: command.onLose }[outcome];
    if (branch) this.stack.push({ commands: branch, index: 0 });
  }

  /** Answer a pending choice with the option at `index`. */
  choose(index: number): void {
    const command = this.choiceCommand;
    if (this.request?.type !== 'choice' || command === null) {
      throw new Error('choose() called while no choice is pending');
    }
    const option = command.options[index];
    if (!option) throw new Error(`choice has no option ${index}`);
    this.request = null;
    this.choiceCommand = null;
    this.stack.push({ commands: option.commands, index: 0 });
  }

  /** Cancel a pending choice. Returns false (and changes nothing) if this choice can't be cancelled. */
  cancel(): boolean {
    if (this.request?.type !== 'choice') {
      throw new Error('cancel() called while no choice is pending');
    }
    if (this.request.cancel === null) return false;
    this.choose(this.request.cancel);
    return true;
  }

  private party(what: string): Party {
    return requireParty(this.context, `the ${what} command`);
  }

  private operand(operand: Operand): number {
    return typeof operand === 'number' ? operand : this.context.state.getVariable(operand.variable);
  }

  /** One member (if they're in the party; nobody otherwise), or everyone. */
  private targets(what: string, actorId: string | undefined) {
    const party = this.party(what);
    if (actorId === undefined) return party.members;
    const member = party.member(actorId);
    return member ? [member] : [];
  }

  /** The next command without consuming it, dropping finished frames. */
  private peek(): Command | null {
    for (let i = this.stack.length - 1; i >= 0; i--) {
      const frame = this.stack[i];
      if (frame) {
        const command = frame.commands[frame.index];
        if (command) return command;
      }
    }
    return null;
  }

  private next(): Command | null {
    for (;;) {
      const frame = this.stack.at(-1);
      if (!frame) return null;
      const command = frame.commands[frame.index];
      if (command) {
        frame.index++;
        return command;
      }
      this.stack.pop();
    }
  }

  private execute(command: Command): void {
    switch (command.type) {
      case 'message':
        this.request = { type: 'message', speaker: command.speaker ?? null, text: command.text };
        break;
      case 'choice':
        this.choiceCommand = command;
        this.request = {
          type: 'choice',
          options: command.options.map((o) => o.label),
          cancel: command.cancel ?? null,
        };
        break;
      case 'if': {
        const branch = evaluateConditions(command.conditions, this.context)
          ? command.then
          : command.else;
        if (branch) this.stack.push({ commands: branch, index: 0 });
        break;
      }
      case 'setSwitch':
        this.context.state.setSwitch(command.switch, command.value);
        break;
      case 'setVariable':
        this.context.state.applyVariable(command.variable, command.op, command.value);
        break;
      case 'transfer':
        this.request = {
          type: 'transfer',
          map: command.map,
          x: command.x,
          y: command.y,
          direction: command.direction ?? null,
        };
        break;
      case 'wait':
        this.waitRemaining = command.seconds;
        break;
      case 'changeGold':
        this.party(command.type).gainGold(this.operand(command.amount));
        break;
      case 'changeItems':
        this.party(command.type).gain(command.kind, command.id, this.operand(command.amount));
        break;
      case 'changeParty': {
        const party = this.party(command.type);
        if (command.action === 'add') party.addMember(command.actor);
        else party.removeMember(command.actor);
        break;
      }
      case 'gainExp': {
        const amount = this.operand(command.amount);
        for (const member of this.targets(command.type, command.actor)) member.gainExp(amount);
        break;
      }
      case 'recoverAll':
        for (const member of this.targets(command.type, command.actor)) member.recoverAll();
        break;
      case 'battle':
        this.battleCommand = command;
        this.request = {
          type: 'battle',
          troop: command.troop,
          canEscape: command.canEscape,
          canLose: command.canLose,
        };
        break;
      case 'comment':
        break;
      default: {
        const unknown: never = command;
        throw new Error(`unknown command ${JSON.stringify(unknown)}`);
      }
    }
  }
}
