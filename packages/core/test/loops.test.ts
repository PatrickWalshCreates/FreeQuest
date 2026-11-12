// Loops repeat their commands until a Break loop; Exit event stops the event.
import type { Command } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { GameState, Interpreter } from '../src/index.js';

const state = () => new GameState({ switches: [], variables: [{ id: 'n', name: 'N' }] });
const add = (by = 1): Command => ({ type: 'setVariable', variable: 'n', op: 'add', value: by });
const whenN = (op: '>=' | '==', value: number, then: Command[]): Command => ({
  type: 'if',
  conditions: [{ type: 'variable', variable: 'n', op, value }],
  then,
});

/** Run until done, answering messages; returns the messages shown. */
function run(commands: Command[], s: GameState): string[] {
  const it = new Interpreter(commands, s);
  const shown: string[] = [];
  for (let i = 0; i < 100 && !it.isDone; i++) {
    it.update(1 / 60);
    const p = it.pending;
    if (p?.type === 'message') {
      shown.push(p.text);
      it.continue();
    }
  }
  expect(it.isDone).toBe(true);
  return shown;
}

describe('loops', () => {
  it('repeats until a break, then carries on after the loop', () => {
    const s = state();
    const shown = run(
      [
        {
          type: 'loop',
          commands: [
            add(),
            whenN('>=', 3, [{ type: 'break' }]),
            { type: 'message', text: 'again' },
          ],
        },
        { type: 'message', text: 'done' },
      ],
      s,
    );
    expect(s.getVariable('n')).toBe(3);
    expect(shown).toEqual(['again', 'again', 'done']);
  });

  it('breaks only the innermost loop', () => {
    const s = new GameState({
      switches: [],
      variables: [
        { id: 'n', name: 'N' },
        { id: 'outer', name: 'Outer' },
      ],
    });
    run(
      [
        {
          type: 'loop',
          commands: [
            { type: 'setVariable', variable: 'outer', op: 'add', value: 1 },
            { type: 'loop', commands: [add(), { type: 'break' }] },
            {
              type: 'if',
              conditions: [{ type: 'variable', variable: 'outer', op: '>=', value: 2 }],
              then: [{ type: 'break' }],
            },
          ],
        },
      ],
      s,
    );
    expect([s.getVariable('outer'), s.getVariable('n')]).toEqual([2, 2]);
  });

  it('keeps going across updates while it waits inside', () => {
    const s = state();
    const it = new Interpreter(
      [{ type: 'loop', commands: [add(), { type: 'wait', seconds: 1 }] }],
      s,
    );
    for (let i = 0; i < 3 * 60 + 1; i++) it.update(1 / 60);
    expect(s.getVariable('n')).toBe(4);
    expect(it.isDone).toBe(false);
  });

  it('stops a loop that never pauses with a clear error', () => {
    const it = new Interpreter([{ type: 'loop', commands: [add()] }], state());
    expect(() => it.update(1 / 60)).toThrow(/does a loop need a Wait, a message or a Break loop/);
  });

  it('treats an empty loop as finished, and a stray break as nothing', () => {
    const s = state();
    run([{ type: 'loop', commands: [] }, { type: 'break' }, add()], s);
    expect(s.getVariable('n')).toBe(1);
  });
});

describe('exit event', () => {
  it('stops the event, from inside loops and branches too', () => {
    const s = state();
    const shown = run(
      [
        { type: 'loop', commands: [add(), whenN('==', 2, [{ type: 'exitEvent' }])] },
        { type: 'message', text: 'never' },
      ],
      s,
    );
    expect(shown).toEqual([]);
    expect(s.getVariable('n')).toBe(2);
  });

  it('stops the calling event from a common event, but a break there stays inside it', () => {
    const s = state();
    const commons: Record<string, Command[]> = {
      stop: [{ type: 'exitEvent' }],
      // A break here can't leave the caller's loop: it does nothing.
      leak: [{ type: 'break' }, add(10)],
    };
    const ctx = { state: s, commonEvent: (id: string) => commons[id] ?? [] };
    const it = new Interpreter(
      [
        {
          type: 'loop',
          commands: [
            add(),
            { type: 'callCommon', common: 'leak' },
            whenN('>=', 22, [{ type: 'break' }]),
          ],
        },
        { type: 'callCommon', common: 'stop' },
        add(1000),
      ],
      ctx,
    );
    for (let i = 0; i < 10 && !it.isDone; i++) it.update(1 / 60);
    expect(it.isDone).toBe(true);
    expect(s.getVariable('n')).toBe(22);
  });
});
