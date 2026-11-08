import type { Condition, EventPage, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { GameState, activePageIndex, evaluateCondition, evaluateConditions } from '../src/index.js';

const declared = () =>
  new GameState({
    switches: [{ id: 'door_open', name: 'Door open' }],
    variables: [
      { id: 'gold', name: 'Gold' },
      { id: 'cost', name: 'Cost' },
    ],
  });

describe('GameState', () => {
  it('defaults switches to false and variables to 0', () => {
    const s = declared();
    expect(s.getSwitch('door_open')).toBe(false);
    expect(s.getVariable('gold')).toBe(0);
  });

  it('rejects ids the manifest does not declare', () => {
    const s = declared();
    expect(() => s.getSwitch('typo')).toThrow(/undeclared switch "typo"/);
    expect(() => s.setVariable('typo', 1)).toThrow(/undeclared variable/);
  });

  it('allows any id when no manifest is given', () => {
    const s = new GameState();
    s.setSwitch('anything', true);
    expect(s.getSwitch('anything')).toBe(true);
  });

  it('applies variable operations', () => {
    const s = declared();
    s.applyVariable('gold', 'set', 10);
    s.applyVariable('gold', 'add', 5);
    s.applyVariable('gold', 'mul', 2);
    s.applyVariable('gold', 'sub', 1);
    expect(s.getVariable('gold')).toBe(29);
    s.applyVariable('gold', 'div', 4);
    expect(s.getVariable('gold')).toBe(7);
    s.applyVariable('gold', 'mod', 4);
    expect(s.getVariable('gold')).toBe(3);
  });

  it('truncates division toward zero and ignores division by zero', () => {
    const s = declared();
    s.setVariable('gold', -7);
    s.applyVariable('gold', 'div', 2);
    expect(s.getVariable('gold')).toBe(-3);
    s.applyVariable('gold', 'div', 0);
    s.applyVariable('gold', 'mod', 0);
    expect(s.getVariable('gold')).toBe(-3);
  });

  it('reads operands from other variables', () => {
    const s = declared();
    s.setVariable('gold', 50);
    s.setVariable('cost', 20);
    s.applyVariable('gold', 'sub', { variable: 'cost' });
    expect(s.getVariable('gold')).toBe(30);
  });

  it('rejects non-integer values', () => {
    expect(() => declared().setVariable('gold', 1.5)).toThrow(/not an integer/);
  });
});

describe('conditions', () => {
  it('checks switches against the expected value', () => {
    const s = declared();
    const on: Condition = { type: 'switch', switch: 'door_open', value: true };
    const off: Condition = { type: 'switch', switch: 'door_open', value: false };
    expect([evaluateCondition(on, s), evaluateCondition(off, s)]).toEqual([false, true]);
    s.setSwitch('door_open', true);
    expect([evaluateCondition(on, s), evaluateCondition(off, s)]).toEqual([true, false]);
  });

  it.each([
    ['==', 5, true],
    ['!=', 5, false],
    ['<', 6, true],
    ['<=', 5, true],
    ['>', 5, false],
    ['>=', 5, true],
  ] as const)('compares variables with %s %d', (op, value, expected) => {
    const s = declared();
    s.setVariable('gold', 5);
    expect(evaluateCondition({ type: 'variable', variable: 'gold', op, value }, s)).toBe(expected);
  });

  it('requires all conditions; an empty list always holds', () => {
    const s = declared();
    s.setVariable('gold', 5);
    const conds: Condition[] = [
      { type: 'variable', variable: 'gold', op: '>=', value: 1 },
      { type: 'switch', switch: 'door_open', value: true },
    ];
    expect(evaluateConditions(conds, s)).toBe(false);
    s.setSwitch('door_open', true);
    expect(evaluateConditions(conds, s)).toBe(true);
    expect(evaluateConditions([], s)).toBe(true);
  });
});

describe('activePageIndex', () => {
  const page = (conditions: Condition[]): EventPage => ({
    conditions,
    trigger: 'action',
    layer: 'same',
    commands: [],
  });
  const event: MapEvent = {
    id: 'npc',
    name: 'NPC',
    x: 0,
    y: 0,
    pages: [
      page([]),
      page([{ type: 'switch', switch: 'door_open', value: true }]),
      page([{ type: 'variable', variable: 'gold', op: '>=', value: 100 }]),
    ],
  };

  it('picks the last page whose conditions hold', () => {
    const s = declared();
    expect(activePageIndex(event, s)).toBe(0);
    s.setSwitch('door_open', true);
    expect(activePageIndex(event, s)).toBe(1);
    s.setVariable('gold', 100);
    expect(activePageIndex(event, s)).toBe(2);
    s.setSwitch('door_open', false);
    expect(activePageIndex(event, s)).toBe(2);
  });

  it('returns -1 when no page is active', () => {
    const s = declared();
    const hidden: MapEvent = {
      ...event,
      pages: [page([{ type: 'switch', switch: 'door_open', value: true }])],
    };
    expect(activePageIndex(hidden, s)).toBe(-1);
  });
});
