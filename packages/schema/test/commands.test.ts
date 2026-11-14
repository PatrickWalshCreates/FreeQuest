import { describe, expect, it } from 'vitest';
import {
  type Command,
  faceImages,
  faceSheetLayout,
  mapCommands,
  parseProjectFile,
  walkCommands,
} from '../src/index.js';

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

describe('message faces', () => {
  it('cuts a face sheet into square faces as tall as the image', () => {
    expect(faceSheetLayout(192, 48)).toEqual({ size: 48, count: 4 });
    expect(faceSheetLayout(100, 48)).toEqual({ size: 48, count: 2 });
    expect(faceSheetLayout(40, 48)).toEqual({ size: 48, count: 0 });
    expect(faceSheetLayout(0, 0)).toEqual({ size: 0, count: 0 });
  });

  it('lists the face images messages use, each once, nested ones included', () => {
    const face = (image: string, index = 0): Command => ({
      type: 'message',
      face: { image, index },
      text: '',
    });
    const lists: Command[][] = [
      [face('a.png'), { type: 'loop', commands: [face('b.png', 1)] }],
      [face('a.png', 3), ...tree],
    ];
    expect(faceImages(lists)).toEqual(['a.png', 'b.png']);
  });

  it('accepts a face on a message and refuses a bad one', () => {
    const map = (face: unknown) => ({
      formatVersion: 8,
      id: 'm',
      name: 'M',
      tileset: 't',
      width: 1,
      height: 1,
      layers: [{ name: 'ground', data: [[0]] }],
      events: [
        {
          id: 'e',
          name: 'E',
          x: 0,
          y: 0,
          pages: [
            {
              trigger: 'action',
              layer: 'same',
              conditions: [],
              commands: [{ type: 'message', face, text: 'hi' }],
            },
          ],
        },
      ],
    });
    expect(() =>
      parseProjectFile('map', map({ image: 'assets/faces/a.png', index: 1 })),
    ).not.toThrow();
    expect(() =>
      parseProjectFile('map', map({ image: 'assets/faces/a.png', index: -1 })),
    ).toThrow();
    expect(() => parseProjectFile('map', map({ image: '', index: 0 }))).toThrow();
  });
});
