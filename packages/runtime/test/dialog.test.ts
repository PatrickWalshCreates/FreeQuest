import { ActionState, type Action, GameState, Interpreter } from '@freequest/core';
import type { Command } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { DialogController } from '../src/dialog.js';

const DT = 1 / 60;

function setup(commands: Command[], charsPerSecond = 60) {
  const state = new GameState();
  const interpreter = new Interpreter(commands, state);
  const dialog = new DialogController({ charsPerSecond });
  const input = new ActionState();
  /** One fixed step in the same order as the game: dialog, then interpreter. */
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      dialog.update(DT, input, interpreter);
      interpreter.update(DT);
      input.endStep();
    }
  };
  const tap = (action: Action) => {
    input.press(action);
    tick();
    input.release(action);
  };
  interpreter.update(DT); // run to the first request, as World does on trigger
  return { state, interpreter, dialog, tick, tap };
}

const say = (text: string, speaker?: string): Command =>
  speaker ? { type: 'message', speaker, text } : { type: 'message', text };

describe('DialogController messages', () => {
  it('reveals text over time, then continues on confirm', () => {
    const { dialog, interpreter, tick, tap } = setup([say('Hello there', 'Elder')], 60);
    tick(); // message picked up
    expect(dialog.message).toMatchObject({ speaker: 'Elder', revealed: 0, complete: false });
    tick(5);
    expect(dialog.message?.revealed).toBeCloseTo(5);
    tick(10);
    expect(dialog.message?.complete).toBe(true);
    tap('confirm');
    expect(interpreter.isDone).toBe(true);
    tick();
    expect(dialog.isOpen).toBe(false);
  });

  it('shows a message’s face, and none for messages without one', () => {
    const face = { image: 'assets/faces/elder.png', index: 2 };
    const { dialog, tick, tap } = setup(
      [{ type: 'message', face, text: 'Hello.' }, say('Bye.')],
      Infinity,
    );
    tick(2);
    expect(dialog.message?.face).toEqual(face);
    tap('confirm');
    tick();
    expect(dialog.message).toMatchObject({ text: 'Bye.', face: null });
  });

  it('first confirm finishes the reveal, second continues', () => {
    const { dialog, interpreter, tick, tap } = setup([say('A long line of text')]);
    tick();
    tap('confirm');
    expect(dialog.message?.complete).toBe(true);
    expect(interpreter.isDone).toBe(false);
    tap('confirm');
    expect(interpreter.isDone).toBe(true);
  });

  it('ignores a confirm in the step the message appears', () => {
    const { dialog, tap } = setup([say('Hi')]);
    tap('confirm');
    expect(dialog.message).toMatchObject({ text: 'Hi', revealed: 0 });
  });

  it('swaps text between consecutive messages without closing the box', () => {
    const { dialog, tick, tap } = setup([say('One'), say('Two')], Infinity);
    tick(2);
    expect(dialog.message?.text).toBe('One');
    tap('confirm'); // continue; interpreter reaches "Two" in the same step
    expect(dialog.message?.text).toBe('One'); // still showing: no flicker
    tick();
    expect(dialog.message).toMatchObject({ text: 'Two', revealed: 0 });
  });
});

describe('DialogController choices', () => {
  const question: Command[] = [
    say('Pick one'),
    {
      type: 'choice',
      cancel: 2,
      options: [
        {
          label: 'Red',
          commands: [{ type: 'setVariable', variable: 'pick', op: 'set', value: 1 }],
        },
        {
          label: 'Green',
          commands: [{ type: 'setVariable', variable: 'pick', op: 'set', value: 2 }],
        },
        {
          label: 'Blue',
          commands: [{ type: 'setVariable', variable: 'pick', op: 'set', value: 3 }],
        },
      ],
    },
  ];

  function toChoice(commands = question) {
    const env = setup(commands, Infinity);
    env.tick(2);
    env.tap('confirm'); // close "Pick one"
    env.tick(); // choice appears
    return env;
  }

  it('keeps the question visible above the choice window', () => {
    const { dialog } = toChoice();
    expect(dialog.choice).toEqual({ options: ['Red', 'Green', 'Blue'], cursor: 0 });
    expect(dialog.message).toMatchObject({ text: 'Pick one', complete: true });
  });

  it('moves the cursor with wrap-around and confirms the selection', () => {
    const { dialog, state, tap } = toChoice();
    tap('up');
    expect(dialog.choice?.cursor).toBe(2);
    tap('down');
    tap('down');
    expect(dialog.choice?.cursor).toBe(1);
    tap('confirm');
    expect(dialog.isOpen).toBe(false);
    expect(state.getVariable('pick')).toBe(2);
  });

  it('cancel picks the cancel option', () => {
    const { state, tap } = toChoice();
    tap('cancel');
    expect(state.getVariable('pick')).toBe(3);
  });

  it('cancel does nothing when the choice has no cancel option', () => {
    const noCancel: Command[] = [
      { type: 'choice', options: [{ label: 'Only way', commands: [] }] },
    ];
    const env = setup(noCancel, Infinity);
    env.tick();
    env.tap('cancel');
    expect(env.dialog.choice).toEqual({ options: ['Only way'], cursor: 0 });
    expect(env.dialog.message).toBeNull();
  });

  it('closes when nothing is pending (e.g. during a wait)', () => {
    const env = setup([say('Wait for it'), { type: 'wait', seconds: 1 }, say('Now')], Infinity);
    env.tick(2);
    env.tap('confirm');
    env.tick();
    expect(env.dialog.isOpen).toBe(false);
    env.tick(60);
    expect(env.dialog.message?.text).toBe('Now');
  });
});
