import { Command, type GameMap, Value } from './typebox.js';
import { describe, expect, it } from 'vitest';
import {
  COMMAND_GROUPS,
  COMMAND_NAMES,
  COMMAND_SCHEMAS,
  CONDITION_SCHEMA,
  addEvent,
  addPage,
  classify,
  defaultFor,
  describeCommand,
  describeCondition,
  describeRoute,
  duplicateEvent,
  duplicatePage,
  eventAt,
  fieldLabel,
  flattenCommands,
  getList,
  insertCommand,
  moveCommand,
  moveEvent,
  movePage,
  newMapData,
  removeCommand,
  removeEvent,
  removePage,
  replaceCommand,
  updatePage,
  variantIndex,
  variantLabel,
} from '../src/index.js';

const blank = (): GameMap => newMapData('m', { name: 'M', width: 5, height: 5, tileset: 't' });

describe('events on a map', () => {
  it('adds, finds, moves, duplicates and removes events', () => {
    const a = addEvent(blank(), 1, 2);
    expect(a.id).toBe('event1');
    expect(eventAt(a.map, 1, 2)?.name).toBe('Event 1');
    const b = addEvent(a.map, 3, 3);
    expect(b.id).toBe('event2');
    const moved = moveEvent(b.map, 'event1', 4, 4);
    expect(eventAt(moved, 4, 4)?.id).toBe('event1');
    expect(eventAt(moved, 1, 2)).toBeUndefined();
    expect(moveEvent(moved, 'event1', 4, 4)).toBe(moved); // no change, same object
    const copy = duplicateEvent(moved, 'event1', 0, 0);
    expect(eventAt(copy.map, 0, 0)?.name).toBe('Event 1 (copy)');
    expect(copy.id).toBe('event3');
    const removed = removeEvent(copy.map, 'event2');
    expect(removed.events.map((e) => e.id)).toEqual(['event1', 'event3']);
    // A removed id is reused.
    expect(addEvent(removed, 2, 2).id).toBe('event2');
  });

  it('rejects cells outside the map and unknown events', () => {
    expect(() => addEvent(blank(), 5, 0)).toThrow(RangeError);
    const { map } = addEvent(blank(), 0, 0);
    expect(() => moveEvent(map, 'event1', -1, 0)).toThrow(RangeError);
    expect(() => moveEvent(map, 'nope', 1, 1)).toThrow(/no event/);
  });

  it('manages pages, always keeping one', () => {
    const { map } = addEvent(blank(), 0, 0);
    const [event] = map.events;
    if (!event) throw new Error('no event');
    const two = addPage({ ...event, pages: [{ ...event.pages[0], trigger: 'touch' } as never] });
    expect(two.pages.map((p) => p.trigger)).toEqual(['touch', 'action']);
    expect(movePage(two, 1, -1).pages.map((p) => p.trigger)).toEqual(['action', 'touch']);
    expect(movePage(two, 1, 1).pages.map((p) => p.trigger)).toEqual(['touch', 'action']);
    expect(duplicatePage(two, 0).pages.map((p) => p.trigger)).toEqual(['touch', 'touch', 'action']);
    expect(removePage(two, 0).pages.map((p) => p.trigger)).toEqual(['action']);
    expect(() => removePage(event, 0)).toThrow(/at least one page/);
    const edited = updatePage(map, 'event1', 0, (p) => ({ ...p, layer: 'below' }));
    expect(edited.events[0]?.pages[0]?.layer).toBe('below');
  });
});

describe('the command tree', () => {
  const tree: Command[] = [
    { type: 'message', text: 'Hello' },
    {
      type: 'choice',
      options: [
        { label: 'Yes', commands: [{ type: 'setSwitch', switch: 'agreed', value: true }] },
        { label: 'No', commands: [] },
      ],
      cancel: 1,
    },
    {
      type: 'if',
      conditions: [{ type: 'switch', switch: 'agreed', value: true }],
      then: [{ type: 'wait', seconds: 1 }],
      else: [],
    },
  ];
  const yes = [{ index: 1, branch: 'option', option: 0 }] as const;

  it('reads and rewrites nested lists, sharing what is unchanged', () => {
    expect(getList(tree, yes)).toHaveLength(1);
    const added = insertCommand(tree, yes, 1, { type: 'comment', text: 'agreed' });
    expect(getList(added, yes).map((c) => c.type)).toEqual(['setSwitch', 'comment']);
    expect(added[0]).toBe(tree[0]);
    expect(added[2]).toBe(tree[2]);
    expect(getList(tree, yes)).toHaveLength(1); // original untouched

    const elsePath = [{ index: 2, branch: 'else' }] as const;
    const filled = insertCommand(tree, elsePath, 0, { type: 'wait', seconds: 2 });
    expect(getList(filled, elsePath)).toEqual([{ type: 'wait', seconds: 2 }]);
    expect(() => getList(tree, [{ index: 0, branch: 'then' }])).toThrow(/no command list/);
  });

  it('replaces, removes and reorders commands within a list', () => {
    const replaced = replaceCommand(tree, [], 0, { type: 'message', text: 'Hi', speaker: 'Elder' });
    expect(replaced[0]).toEqual({ type: 'message', text: 'Hi', speaker: 'Elder' });
    expect(removeCommand(tree, [], 0).map((c) => c.type)).toEqual(['choice', 'if']);
    expect(moveCommand(tree, [], 2, -2).map((c) => c.type)).toEqual(['if', 'message', 'choice']);
    expect(moveCommand(tree, [], 0, -1).map((c) => c.type)).toEqual(['message', 'choice', 'if']);
    expect(() => replaceCommand(tree, [], 9, { type: 'comment', text: '' })).toThrow(RangeError);
  });

  it('flattens into rows with branch headings and end slots', () => {
    const rows = flattenCommands(tree).map((r) =>
      r.kind === 'command'
        ? `${'  '.repeat(r.depth)}${r.command.type}`
        : r.kind === 'branch'
          ? `${'  '.repeat(r.depth)}[${r.label}]`
          : `${'  '.repeat(r.depth)}+`,
    );
    expect(rows).toEqual([
      'message',
      'choice',
      '  [When “Yes”]',
      '    setSwitch',
      '    +',
      '  [When “No”]',
      '    +',
      'if',
      '  wait',
      '  +',
      '  [Else]',
      '    +',
      '+',
    ]);
    const end = flattenCommands(tree).find((r) => r.kind === 'end' && r.path.length === 1);
    expect(end).toMatchObject({ path: yes, index: 1 });
  });
});

describe('descriptions', () => {
  it('summarises every command type in one line', () => {
    const cases: [Command, string][] = [
      [
        { type: 'message', speaker: 'Elder', text: 'Hello there\nsecond line' },
        'Elder: “Hello there…”',
      ],
      [{ type: 'message', text: 'Hi' }, 'Message: “Hi”'],
      [
        {
          type: 'choice',
          options: [
            { label: 'A', commands: [] },
            { label: 'B', commands: [] },
          ],
        },
        'Choice: A / B',
      ],
      [{ type: 'setSwitch', switch: 's', value: false }, 'Turn s off'],
      [{ type: 'setVariable', variable: 'v', op: 'add', value: { variable: 'w' } }, 'v += w'],
      [
        { type: 'transfer', map: 'house', x: 1, y: 2, direction: 'up' },
        'Transfer to house (1, 2) facing up',
      ],
      [{ type: 'wait', seconds: 0.5 }, 'Wait 0.5 s'],
      [{ type: 'changeGold', amount: -20 }, 'Lose 20 gold'],
      [{ type: 'changeItems', kind: 'item', id: 'potion', amount: 2 }, 'Gain 2 × potion'],
      [{ type: 'changeParty', action: 'add', actor: 'mira' }, 'mira joins the party'],
      [{ type: 'gainExp', amount: 50 }, 'Party gains 50 exp'],
      [{ type: 'recoverAll' }, 'Fully recover the party'],
      [
        { type: 'battle', troop: 'wolf', canEscape: false, canLose: true },
        'Battle: wolf (can lose)',
      ],
      [{ type: 'playMusic', path: null }, 'Stop music'],
      [{ type: 'playSound', path: 'assets/audio/heal.wav' }, 'Play sound heal.wav'],
      [{ type: 'comment', text: 'todo' }, '// todo'],
    ];
    for (const [command, text] of cases) expect(describeCommand(command)).toBe(text);
    expect(
      describeCommand({
        type: 'if',
        conditions: [
          { type: 'gold', op: '>=', value: 10 },
          { type: 'hasItem', kind: 'item', id: 'key', count: 2 },
        ],
        then: [],
      }),
    ).toBe('If gold >= 10 and has 2 × key');
    expect(describeCondition({ type: 'inParty', actor: 'mira' })).toBe('mira is in the party');
  });

  it('names every command type in the add menu exactly once', () => {
    const offered = COMMAND_GROUPS.flatMap((g) => g.types);
    expect(new Set(offered).size).toBe(offered.length);
    expect([...offered].sort()).toEqual([...COMMAND_SCHEMAS.keys()].sort());
    expect(Object.keys(COMMAND_NAMES).sort()).toEqual([...COMMAND_SCHEMAS.keys()].sort());
  });
});

describe('schema forms', () => {
  it('classifies the shapes commands use', () => {
    const transfer = COMMAND_SCHEMAS.get('transfer');
    const props = transfer?.properties ?? {};
    expect(classify(props['type'] ?? {})).toEqual({ kind: 'fixed', value: 'transfer' });
    expect(classify(props['direction'] ?? {})).toMatchObject({
      kind: 'choice',
      options: ['down', 'left', 'right', 'up'],
    });
    expect(classify(props['x'] ?? {}).kind).toBe('integer');
    const music = COMMAND_SCHEMAS.get('playMusic')?.properties?.['path'] ?? {};
    expect(classify(music).kind).toBe('nullable');
    const amount = COMMAND_SCHEMAS.get('changeGold')?.properties?.['amount'] ?? {};
    expect(classify(amount).kind).toBe('union');
    const then = COMMAND_SCHEMAS.get('if')?.properties?.['then'] ?? {};
    expect(classify(then)).toMatchObject({ kind: 'array', item: { $ref: 'Command' } });
  });

  it('makes valid default commands and conditions, using picked references', () => {
    const pick = (field: string) =>
      ({
        switch: 'agreed',
        variable: 'count',
        map: 'house',
        troop: 'wolf',
        actor: 'mira',
        id: 'potion',
        path: 'assets/audio/a.wav',
        target: 'this',
      })[field];
    for (const [type, schema] of COMMAND_SCHEMAS) {
      const command = defaultFor(schema, pick);
      expect(Value.Check(Command, command), type).toBe(true);
    }
    expect(defaultFor(COMMAND_SCHEMAS.get('wait') ?? {})).toEqual({ type: 'wait', seconds: 1 });
    expect(defaultFor(COMMAND_SCHEMAS.get('choice') ?? {}, pick)).toEqual({
      type: 'choice',
      options: [{ label: 'x', commands: [] }],
    });
  });

  it('tells union variants apart', () => {
    const variants = CONDITION_SCHEMA.anyOf ?? [];
    expect(variants.map(variantLabel)).toEqual([
      'switch',
      'variable',
      'gold',
      'hasItem',
      'inParty',
    ]);
    expect(variantIndex(variants, { type: 'gold', op: '>', value: 1 })).toBe(2);
    expect(variantIndex(variants, { nonsense: true })).toBe(0);
    const operand = COMMAND_SCHEMAS.get('changeGold')?.properties?.['amount']?.anyOf ?? [];
    expect(variantIndex(operand, 5)).toBe(0);
    expect(variantIndex(operand, { variable: 'v' })).toBe(1);
    expect(variantLabel(operand[1] ?? {})).toBe('variable');
    expect(fieldLabel('includeEquipped')).toBe('Include equipped');
  });
});

describe('route descriptions', () => {
  it('counts runs of the same step', () => {
    expect(
      describeRoute([
        { type: 'move', direction: 'up' },
        { type: 'move', direction: 'up' },
        { type: 'wait', seconds: 1 },
        { type: 'turn', direction: 'toward-player' },
        { type: 'speed', speed: 6 },
        { type: 'move', direction: 'away-from-player' },
      ]),
    ).toBe('↑ ×2, wait 1 s, turn toward player, speed 6, away from player');
    expect(
      describeCommand({
        type: 'moveRoute',
        target: 'player',
        steps: [{ type: 'move', direction: 'left' }],
        repeat: false,
        skipBlocked: true,
        wait: true,
      }),
    ).toBe('Move the player: ← (skip blocked, wait)');
  });
});
