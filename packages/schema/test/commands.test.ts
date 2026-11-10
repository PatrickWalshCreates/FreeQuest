import { describe, expect, it } from 'vitest';
import { type Command, mapCommands, walkCommands } from '../src/index.js';

const tree: Command[] = [
  { type: 'message', text: 'hi' },
  {
    type: 'if',
    conditions: [{ type: 'switch', switch: 's', value: true }],
    then: [{ type: 'transfer', map: 'a', x: 1, y: 1 }],
    else: [
      {
        type: 'choice',
        options: [{ label: 'Go', commands: [{ type: 'transfer', map: 'b', x: 2, y: 2 }] }],
        cancel: 0,
      },
    ],
  },
  {
    type: 'battle',
    troop: 't',
    canEscape: true,
    canLose: false,
    onWin: [{ type: 'transfer', map: 'a', x: 3, y: 3 }],
  },
];

describe('mapCommands', () => {
  it('keeps identity when nothing changes', () => {
    expect(mapCommands(tree, (c) => c)).toBe(tree);
  });

  it('rewrites nested commands and copies only the changed branches', () => {
    const out = mapCommands(tree, (c) =>
      c.type === 'transfer' && c.map === 'a' ? { ...c, x: c.x + 10 } : c,
    );
    const xs: number[] = [];
    walkCommands(out, (c) => {
      if (c.type === 'transfer') xs.push(c.x);
    });
    expect(xs).toEqual([11, 2, 13]);
    expect(out[0]).toBe(tree[0]);
    const before = tree[1] as Extract<Command, { type: 'if' }>;
    const after = out[1] as Extract<Command, { type: 'if' }>;
    expect(after.else).toBe(before.else);
    expect(after.then).not.toBe(before.then);
  });
});
