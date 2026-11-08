import { describe, expect, it } from 'vitest';
import { type FormulaContext, type FormulaSubject, evaluateFormula } from '../src/index.js';

function subject(values: Record<string, number>): FormulaSubject {
  return { formulaValue: (key) => values[key] ?? 0 };
}

function ctx(overrides: Partial<FormulaContext> = {}): FormulaContext {
  return {
    a: subject({ attack: 30, magicAttack: 20, hp: 50, maxHp: 200, level: 5 }),
    b: subject({ defense: 10, magicDefense: 8, hp: 80, maxHp: 400 }),
    variable: (id) => ({ rage: 3, 'bridge-visits': 2 })[id] ?? 0,
    random: () => 0.5,
    ...overrides,
  };
}

const run = (source: string, c = ctx()) => evaluateFormula(source, c);

describe('evaluateFormula', () => {
  it('computes the classic damage formula', () => {
    expect(run('a.attack * 4 - b.defense * 2')).toBe(100);
  });

  it('respects precedence and parentheses', () => {
    expect(run('2 + 3 * 4')).toBe(14);
    expect(run('(2 + 3) * 4')).toBe(20);
    expect(run('-2 * -3')).toBe(6);
    expect(run('10 - 2 - 3')).toBe(5); // left-associative
    expect(run('7 % 4')).toBe(3);
  });

  it('reads variables by dotted or quoted id', () => {
    expect(run('v.rage * 10')).toBe(30);
    expect(run('v["bridge-visits"] + 1')).toBe(3);
    expect(run('v.unset')).toBe(0);
  });

  it('turns comparisons and logic into 1 or 0', () => {
    expect(run('a.hp < a.maxHp / 2')).toBe(1);
    expect(run('a.hp >= b.hp')).toBe(0);
    expect(run('1 == 1 && 2 != 2')).toBe(0);
    expect(run('0 || 5')).toBe(1);
    expect(run('!0 + !3')).toBe(1);
  });

  it('short-circuits && and ||', () => {
    let calls = 0;
    const counting = ctx({
      variable: () => {
        calls++;
        return 1;
      },
    });
    run('0 && v.x', counting);
    run('1 || v.x', counting);
    expect(calls).toBe(0);
  });

  it('picks a branch with the conditional operator', () => {
    expect(run('v.rage > 2 ? a.magicAttack * 3 : a.magicAttack')).toBe(60);
    expect(run('v.rage > 5 ? 1 : v.rage > 2 ? 2 : 3')).toBe(2);
  });

  it('provides the math functions', () => {
    expect(run('max(100, b.maxHp * 0.3)')).toBe(120);
    expect(run('min(4, 2, 8)')).toBe(2);
    expect(run('abs(-3) + floor(2.7) + ceil(2.1) + round(2.5)')).toBe(3 + 2 + 3 + 3);
    expect(run('clamp(150, 0, 100)')).toBe(100);
  });

  it('draws random integers inclusively from the injected source', () => {
    expect(run('random(1, 6)', ctx({ random: () => 0 }))).toBe(1);
    expect(run('random(1, 6)', ctx({ random: () => 0.9999 }))).toBe(6);
    expect(run('random(6, 1)', ctx({ random: () => 0 }))).toBe(1);
  });

  it('never returns NaN or Infinity', () => {
    expect(run('1 / 0')).toBe(0);
    expect(run('5 % 0')).toBe(0);
    expect(run('99999999' + ' * 99999999'.repeat(40))).toBe(0); // overflows to Infinity
  });

  it('throws for invalid formulas', () => {
    expect(() => run('a.attack +')).toThrow(/unexpected end/);
  });
});
