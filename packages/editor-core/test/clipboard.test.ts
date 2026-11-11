import type { Command, GameMap, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  EditorClipboard,
  getList,
  insertCommands,
  nearestFreeCell,
  pasteEntry,
  pasteEvent,
  removeCommands,
  sliceCommands,
} from '../src/index.js';

const message = (text: string): Command => ({ type: 'message', text });
const tree: Command[] = [
  message('a'),
  { type: 'if', conditions: [], then: [message('b'), message('c'), message('d')], else: null },
  message('e'),
] as Command[];
const inThen = [{ index: 1, branch: 'then' as const }];

function map(events: Pick<MapEvent, 'x' | 'y'>[] = [], width = 3, height = 3): GameMap {
  return {
    formatVersion: 5,
    id: 'm',
    name: 'M',
    width,
    height,
    tileset: 'ts',
    layers: [],
    events: events.map((e, i) => ({
      id: `event${i + 1}`,
      name: `Event ${i + 1}`,
      ...e,
      pages: [],
    })),
  } as unknown as GameMap;
}

describe('EditorClipboard', () => {
  it('keeps copies, not the originals, and notifies', () => {
    const board = new EditorClipboard();
    let calls = 0;
    board.subscribe(() => calls++);
    const commands = [message('hi')];
    board.set({ kind: 'commands', commands });
    expect(calls).toBe(1);
    const pasted = board.commands();
    expect(pasted).toEqual(commands);
    expect(pasted?.[0]).not.toBe(commands[0]);
    expect(board.event()).toBeNull();
    expect(board.entry('items')).toBeNull();
  });

  it('only gives entries back to their own category', () => {
    const board = new EditorClipboard();
    board.set({ kind: 'entry', category: 'items', entry: { id: 'potion', name: 'Potion' } });
    expect(board.entry('items')).toEqual({ id: 'potion', name: 'Potion' });
    expect(board.entry('skills')).toBeNull();
  });
});

describe('command blocks', () => {
  it('slices, removes and inserts ranges in nested lists', () => {
    expect(sliceCommands(tree, inThen, 1, 2)).toEqual([message('c'), message('d')]);
    const removed = removeCommands(tree, inThen, 0, 2);
    expect(getList(removed, inThen)).toEqual([message('d')]);
    const inserted = insertCommands(removed, [], 3, [message('x'), message('y')]);
    expect(inserted.map((c) => (c.type === 'message' ? c.text : c.type))).toEqual([
      'a',
      'if',
      'e',
      'x',
      'y',
    ]);
    expect(tree).toHaveLength(3);
  });
});

describe('pasting events', () => {
  it('finds the nearest free cell', () => {
    expect(nearestFreeCell(map(), 1, 1)).toEqual({ x: 1, y: 1 });
    expect(nearestFreeCell(map([{ x: 1, y: 1 }]), 1, 1)).toEqual({ x: 1, y: 0 });
    expect(nearestFreeCell(map(), 9, -4)).toEqual({ x: 2, y: 0 });
    const full = map([{ x: 0, y: 0 }], 1, 1);
    expect(nearestFreeCell(full, 0, 0)).toBeNull();
  });

  it('adds a copy under a new id at a free cell', () => {
    const target = map([{ x: 0, y: 0 }]);
    const source = target.events[0] as MapEvent;
    const result = pasteEvent(target, source, 0, 0);
    expect(result.id).toBe('event2');
    const pasted = result.map.events[1];
    expect(pasted).toMatchObject({ id: 'event2', name: 'Event 1', x: 1, y: 0 });
    expect(() => pasteEvent(map([{ x: 0, y: 0 }], 1, 1), source, 0, 0)).toThrow(/Every cell/);
  });
});

describe('pasting entries', () => {
  const file = { formatVersion: 3, entries: [{ id: 'potion', name: 'Potion' }] };

  it('keeps a free id, so references still match', () => {
    const result = pasteEntry({ formatVersion: 3, entries: [] }, { id: 'potion', name: 'Potion' });
    expect(result.id).toBe('potion');
    expect(result.file.entries).toEqual([{ id: 'potion', name: 'Potion' }]);
  });

  it('renames a clash and puts it after the chosen entry', () => {
    const two = { ...file, entries: [...file.entries, { id: 'ether', name: 'Ether' }] };
    const result = pasteEntry(two, { id: 'potion', name: 'Potion' }, 'potion');
    expect(result.id).toBe('potion-2');
    expect(result.file.entries.map((e) => e.id)).toEqual(['potion', 'potion-2', 'ether']);
    expect(result.file.entries[1]?.name).toBe('Potion (copy)');
  });
});
