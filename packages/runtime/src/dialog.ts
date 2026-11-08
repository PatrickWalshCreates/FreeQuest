// Dialog UI logic: which message is showing, how much of it is revealed,
// where the choice cursor is, and how input answers the interpreter.
// Deliberately free of PixiJS so it can be unit-tested in Node; `dialog-view.ts`
// draws whatever state this holds.
import type { InputState, InterpreterRequest } from '@freequest/core';

/** The part of an Interpreter the dialog needs. */
export interface DialogTarget {
  readonly pending: InterpreterRequest | null;
  continue(): void;
  choose(index: number): void;
  cancel(): boolean;
}

export interface MessageState {
  readonly speaker: string | null;
  readonly text: string;
  /** Characters of `text` revealed so far (may be fractional). */
  readonly revealed: number;
  readonly complete: boolean;
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
      text: request.text,
      revealed: Math.min(this.revealed, request.text.length),
      complete: this.revealed >= request.text.length,
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
        return; // a fresh message ignores input from the step it appeared in
      }
      if (this.revealed < request.text.length) {
        this.revealed += dt * this.charsPerSecond;
        if (input.justPressed('confirm')) this.revealed = request.text.length;
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
        if (this.messageRequest) this.revealed = this.messageRequest.text.length;
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

  private close(): void {
    this.messageRequest = null;
    this.choiceRequest = null;
    this.revealed = 0;
    this.cursor = 0;
  }
}
