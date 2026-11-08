import { describe, expect, it } from 'vitest';
import {
  FormulaError,
  MAX_FORMULA_LENGTH,
  checkFormula,
  formulaVariables,
  parseFormula,
} from '../src/index.js';

describe('parseFormula', () => {
  it('parses the usual damage formula shape', () => {
    expect(parseFormula('a.attack * 4 - b.defense * 2')).toEqual({
      kind: 'binary',
      op: '-',
      left: {
        kind: 'binary',
        op: '*',
        left: { kind: 'subject', subject: 'a', key: 'attack' },
        right: { kind: 'number', value: 4 },
      },
      right: {
        kind: 'binary',
        op: '*',
        left: { kind: 'subject', subject: 'b', key: 'defense' },
        right: { kind: 'number', value: 2 },
      },
    });
  });

  it('accepts every documented construct', () => {
    for (const ok of [
      '100',
      '.5 + 1.25',
      '-a.hp',
      '!(a.level > 10)',
      'max(100, b.maxHp * 0.3)',
      'min(1, 2, 3, 4)',
      'clamp(a.luck - b.luck, 0, 50)',
      'random(1, 6) + floor(a.agility / 4)',
      'v.boss_rage >= 2 ? a.magicAttack * 3 : a.magicAttack * 2',
      'v["bridge-visits"] * 10',
      "v['quoted'] + 1",
      'a.hp < a.maxHp / 4 && b.mp > 0 || 0',
      'a.attack % 7',
    ]) {
      expect(() => parseFormula(ok), ok).not.toThrow();
    }
  });

  it('binds * tighter than +, and comparisons looser than arithmetic', () => {
    const node = parseFormula('1 + 2 * 3 > 6');
    expect(node).toMatchObject({ kind: 'binary', op: '>', left: { op: '+' } });
  });

  it.each([
    ['', /unexpected end/],
    ['1 +', /unexpected end/],
    ['(1 + 2', /expected "\)"/],
    ['1 2', /unexpected input/],
    ['a.strength', /unknown property/],
    ['c.attack', /unknown name "c"/],
    ['window.alert(1)', /unknown name "window"/],
    ['Math.random()', /unknown name "Math"/],
    ['max()', /at least 1 argument/],
    ['clamp(1, 2)', /takes 3 argument/],
    ['random(1)', /takes 2 argument/],
    ['v', /use v\.<id>/],
    ['v["unterminated', /unterminated string/],
    ['1 < 2 < 3', /cannot be chained/],
    ['a.attack ; 1', /unexpected character ";"/],
    ['a.b = 1', /unexpected character "="/],
  ])('rejects %j', (source, message) => {
    expect(() => parseFormula(source)).toThrow(message);
  });

  it('reports the position of the problem', () => {
    try {
      parseFormula('a.attack * x');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError);
      expect((e as FormulaError).position).toBe(11);
    }
  });

  it('refuses huge or deeply nested input instead of overflowing the stack', () => {
    expect(() => parseFormula('1+'.repeat(MAX_FORMULA_LENGTH) + '1')).toThrow(/longer than/);
    expect(() => parseFormula('('.repeat(200) + '1' + ')'.repeat(200))).toThrow(
      /nested too deeply/,
    );
    expect(() => parseFormula('-'.repeat(200) + '1')).toThrow(/nested too deeply/);
  });
});

describe('checkFormula', () => {
  it('returns null for valid formulas and a message otherwise', () => {
    expect(checkFormula('a.attack * 2')).toBeNull();
    expect(checkFormula('a.attack *')).toMatch(/unexpected end/);
  });

  it('checks variables against the declared set', () => {
    const declared = new Set(['gold_found']);
    expect(checkFormula('v.gold_found + 1', declared)).toBeNull();
    expect(checkFormula('v.typo + 1', declared)).toBe('undeclared variable "typo"');
  });

  it('lists the variables a formula reads', () => {
    expect(formulaVariables(parseFormula('v.a + max(v["b-c"], a.hp) ? v.d : 0'))).toEqual([
      'a',
      'b-c',
      'd',
    ]);
  });
});
