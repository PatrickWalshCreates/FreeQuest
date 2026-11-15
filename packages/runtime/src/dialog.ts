// Dialog UI logic: which message is showing, how much of it is revealed,
// where the choice cursor is, and how input answers the interpreter.
// Deliberately free of PixiJS so it can be unit-tested in Node; `dialog-view.ts`
// draws whatever state this holds.
import type { InputState, InterpreterRequest, TextRun } from '@freequest/core';
import type { MessageFace } from '@freequest/schema';
import { type RevealMark, revealMarks, runsLength } from './rich-text.js';

/** The part of an Interpreter the dialog needs. */
export interface DialogTarget {
  readonly pending: InterpreterRequest | null;
  continue(): void;
  choose(index: number): void;
  cancel(): boolean;
}

export interface MessageState {
  readonly speaker: string | null;
  /** A face beside the text, or null. */
  readonly face: MessageFace | null;
  /** The message as plain text (codes filled in). */
  readonly text: string;
  /** The same with colours and icons, for drawing. */
  readonly runs: readonly TextRun[];
  /** Reveal units shown so far: characters and icons (may be fractional). */
  readonly revealed: number;
  readonly complete: boolean;
  /** Stopped at a `{key}` until the player presses confirm. */
  readonly waitingForKey: boolean;
}

export interface ChoiceState {
  readonly options: readonly string[];
  readonly cursor: number;
}

export interface DialogOptions {
  /** Text reveal speed. `Infinity` shows messages instantly. */
  charsPerSecond?: number;
}

type MessageRequest = Extract<InterpreterRequest, { type: 'message' }>;
type ChoiceRequest = Extract<InterpreterRequest, { type: 'choice' }>;

export class DialogController {
  private readonly charsPerSecond: number;
  private messageRequest: MessageRequest | null = null;
  private choiceRequest: ChoiceRequest | null = null;
  private revealed = 0;
  /** Reveal units in the current message (characters and icons). */
  private length = 0;
  /** The message's pauses, waits for a key and instant parts, in order; `nextMark` is the next to reach. */
  private marks: readonly RevealMark[] = [];
  private nextMark = 0;
  /** Seconds left of a `{wait}`. */
  private waitLeft = 0;
  private waitingKey = false;
  /** Inside `{instant}`…`{/instant}`. */
  private instant = false;
  private cursor = 0;

  constructor(options: DialogOptions = {}) {
    this.charsPerSecond = options.charsPerSecond ?? 60;
  }

  /** The message box contents, or null when the box is closed. */
  get message(): MessageState | null {
    const request = this.messageRequest;
    if (!request) return null;
    return {
      speaker: request.speaker,
      face: request.face,
      text: request.text,
      runs: request.runs,
      revealed: Math.min(this.revealed, this.length),
      complete: this.complete,
      waitingForKey: this.waitingKey,
    };
  }

  /** The choice window contents, or null when it is closed. */
  get choice(): ChoiceState | null {
    return this.choiceRequest ? { options: this.choiceRequest.options, cursor: this.cursor } : null;
  }

  /** True while the dialog is waiting on the player. */
  get isOpen(): boolean {
    return this.messageRequest !== null || this.choiceRequest !== null;
  }

  /**
   * Call once per fixed logic step, before the world steps, so the input that
   * answers a request is consumed here.
   */
  update(dt: number, input: InputState, target: DialogTarget | null): void {
    const request = target?.pending ?? null;

    if (request?.type === 'message') {
      if (request !== this.messageRequest) {
        this.messageRequest = request;
        this.choiceRequest = null;
        this.revealed = 0;
        this.length = runsLength(request.runs);
        this.marks = revealMarks(request.runs);
        this.nextMark = 0;
        this.waitLeft = 0;
        this.waitingKey = false;
        this.instant = false;
        this.advance(0);
        return; // a fresh message ignores input from the step it appeared in
      }
      if (!this.complete) {
        if (this.waitingKey) {
          if (input.justPressed('confirm')) {
            this.waitingKey = false;
            this.advance(0);
          }
        } else if (input.justPressed('confirm')) this.skip();
        else this.advance(dt);
        return;
      }
      // Keep the message showing until the next request arrives, so
      // back-to-back messages (or a message then a choice) don't flicker.
      if (input.justPressed('confirm')) target?.continue();
      return;
    }

    if (request?.type === 'choice') {
      if (request !== this.choiceRequest) {
        this.choiceRequest = request;
        this.cursor = 0;
        // The message that asked the question stays up, fully revealed.
        if (this.messageRequest) this.showAll();
        return;
      }
      const count = request.options.length;
      if (input.justPressed('down')) this.cursor = (this.cursor + 1) % count;
      if (input.justPressed('up')) this.cursor = (this.cursor - 1 + count) % count;
      if (input.justPressed('confirm')) {
        target?.choose(this.cursor);
        this.close();
      } else if (input.justPressed('cancel') && target?.cancel()) {
        this.close();
      }
      return;
    }

    // No dialog request pending (event finished, waiting, transferring...).
    this.close();
  }

  /** Fully shown, past every pause and wait. */
  private get complete(): boolean {
    return (
      this.revealed >= this.length &&
      this.nextMark >= this.marks.length &&
      this.waitLeft <= 0 &&
      !this.waitingKey
    );
  }

  /**
   * Reveal for `dt` seconds: characters at the reveal speed, all at once
   * inside instant text, stopping at a pause (for its seconds) or a wait
   * for a key.
   */
  private advance(dt: number): void {
    if (this.waitLeft > 0) {
      this.waitLeft -= dt;
      if (this.waitLeft > 1e-9) return; // (steps of 1/60 don't add up exactly)
      dt = Math.max(0, -this.waitLeft); // time left over reveals on
      this.waitLeft = 0;
    }
    let budget = dt > 0 ? dt * this.charsPerSecond : 0; // (0 × Infinity would be NaN)
    for (let guard = 0; guard <= this.marks.length + 1; guard++) {
      this.reachMarks();
      if (this.waitingKey || this.waitLeft > 0) return;
      const stop = this.marks[this.nextMark]?.at ?? this.length;
      if (this.instant) {
        this.revealed = Math.max(this.revealed, stop);
      } else {
        const room = stop - this.revealed;
        if (budget < room) {
          this.revealed += budget;
          return;
        }
        this.revealed = stop;
        budget -= room;
      }
      if (this.nextMark >= this.marks.length) return;
    }
  }

  /** Act on the marks the reveal has reached: start a pause, a wait for a key, or instant text. */
  private reachMarks(): void {
    for (
      let mark = this.marks[this.nextMark];
      mark && mark.at <= this.revealed;
      mark = this.marks[this.nextMark]
    ) {
      this.nextMark++;
      if (mark.kind === 'instant') this.instant = mark.on;
      else if (mark.kind === 'wait') {
        this.waitLeft = mark.seconds;
        return;
      } else {
        this.waitingKey = true;
        return;
      }
    }
  }

  /** Confirm during the reveal: show the text up to the next wait for a key (skipping pauses), or all of it. */
  private skip(): void {
    this.waitLeft = 0;
    for (let mark = this.marks[this.nextMark]; mark; mark = this.marks[this.nextMark]) {
      this.nextMark++;
      this.revealed = Math.max(this.revealed, mark.at);
      if (mark.kind === 'key') {
        this.waitingKey = true;
        return;
      }
      if (mark.kind === 'instant') this.instant = mark.on;
    }
    this.revealed = this.length;
  }

  private showAll(): void {
    this.revealed = this.length;
    this.nextMark = this.marks.length;
    this.waitLeft = 0;
    this.waitingKey = false;
  }

  private close(): void {
    this.messageRequest = null;
    this.choiceRequest = null;
    this.revealed = 0;
    this.length = 0;
    this.marks = [];
    this.nextMark = 0;
    this.waitLeft = 0;
    this.waitingKey = false;
    this.instant = false;
    this.cursor = 0;
  }
}
