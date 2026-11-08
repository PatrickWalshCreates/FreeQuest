import { describe, expect, it } from 'vitest';
import { Actor, DatabaseIndex, curveValue, expForLevel } from '../src/index.js';
import { demoDb } from './demo-db.js';

describe('curveValue', () => {
  const curve = { 1: 100, 11: 200, 51: 1000 };

  it('returns defined points exactly', () => {
    expect([curveValue(curve, 1), curveValue(curve, 11), curveValue(curve, 51)]).toEqual([
      100, 200, 1000,
    ]);
  });

  it('interpolates linearly between points and rounds', () => {
    expect(curveValue(curve, 6)).toBe(150);
    expect(curveValue(curve, 31)).toBe(600);
    expect(curveValue({ 1: 0, 4: 1 }, 2)).toBe(0); // 0.33 rounds down
  });

  it('is flat beyond the ends', () => {
    expect(curveValue(curve, 99)).toBe(1000);
    expect(curveValue({ 5: 40 }, 1)).toBe(40);
  });

  it('does not depend on key order in the file', () => {
    expect(curveValue({ 51: 1000, 1: 100, 11: 200 }, 6)).toBe(150);
  });
});

describe('expForLevel', () => {
  it('is 0 at level 1 and follows base * (L - 1) ^ exponent', () => {
    const curve = { base: 30, exponent: 2 };
    expect(expForLevel(curve, 1)).toBe(0);
    expect(expForLevel(curve, 2)).toBe(30);
    expect(expForLevel(curve, 3)).toBe(120);
    expect(expForLevel(curve, 11)).toBe(3000);
  });
});

describe('Actor', () => {
  const db = demoDb();

  it('starts at its database level with full HP/MP', () => {
    const mira = new Actor(db, 'mira');
    expect(mira.level).toBe(3);
    expect(mira.exp).toBe(expForLevel(mira.classEntry.exp, 3));
    expect(mira.hp).toBe(mira.maxHp);
    expect(mira.mp).toBe(mira.maxMp);
  });

  it('combines class curves with equipment bonuses', () => {
    const hero = new Actor(db, 'hero'); // warrior, bronze sword (+10 atk), leather vest (+8 def)
    expect(hero.stat('attack')).toBe(14 + 10);
    expect(hero.stat('defense')).toBe(12 + 8);
    expect(hero.stat('maxHp')).toBe(120);
    // Class modifiers: physical attack element.
    expect(hero.attackElements()).toEqual(['physical']);
  });

  it('applies rates after flat bonuses: (base + flat) × rate', () => {
    const data = db.data;
    const berserk = {
      id: 'berserk',
      name: 'Berserk',
      priority: 10,
      restriction: 'none' as const,
      knockout: false,
      removal: { battleEnd: true },
      modifiers: [
        { type: 'statRate' as const, stat: 'attack' as const, value: 1.5 },
        { type: 'statRate' as const, stat: 'defense' as const, value: 0.5 },
      ],
    };
    const withBerserk = new DatabaseIndex({ ...data, states: [...data.states, berserk] });
    const hero = new Actor(withBerserk, 'hero');
    hero.addState('berserk');
    expect(hero.stat('attack')).toBe((14 + 10) * 1.5);
    expect(hero.stat('defense')).toBe((12 + 8) * 0.5);
    hero.removeState('berserk');
    expect(hero.stat('attack')).toBe(24);
  });

  it('levels up through several thresholds at once and learns skills', () => {
    const hero = new Actor(db, 'hero');
    expect(hero.skills).toEqual([]);
    const result = hero.gainExp(expForLevel(hero.classEntry.exp, 4));
    expect(result).toEqual({ levelsGained: 3, learnedSkills: ['power-strike'] });
    expect(hero.level).toBe(4);
    expect(hero.stat('maxHp')).toBeGreaterThan(120);
  });

  it('keeps current HP on level up (max HP grows, HP does not refill)', () => {
    const hero = new Actor(db, 'hero');
    hero.setHp(50);
    hero.changeLevel(10);
    expect(hero.hp).toBe(50);
  });

  it('caps exp at max level', () => {
    const hero = new Actor(db, 'hero');
    hero.gainExp(1e12);
    expect(hero.level).toBe(99);
    expect(hero.exp).toBe(expForLevel(hero.classEntry.exp, 99));
    expect(hero.nextLevelExp).toBeNull();
  });

  it('can be lowered with changeLevel, forgetting class skills above it', () => {
    const mira = new Actor(db, 'mira');
    mira.changeLevel(6);
    expect(mira.skills).toContain('blizzard');
    mira.changeLevel(2);
    expect(mira.skills).toEqual(['fire', 'heal']);
    expect(mira.mp).toBeLessThanOrEqual(mira.maxMp);
  });

  it('keeps skills learned outside the class table', () => {
    const hero = new Actor(db, 'hero');
    hero.learnSkill('heal');
    hero.changeLevel(1);
    expect(hero.skills).toEqual(['heal']);
    expect(() => hero.learnSkill('nope')).toThrow(/unknown skill/);
  });

  it('clamps HP and MP and knocks out at 0 HP', () => {
    const hero = new Actor(db, 'hero');
    hero.setHp(9999);
    expect(hero.hp).toBe(hero.maxHp);
    hero.setHp(-5);
    expect(hero.hp).toBe(0);
    expect(hero.isKnockedOut).toBe(true);
    hero.setHp(50); // knocked out battlers stay at 0
    expect(hero.hp).toBe(0);
    hero.removeState('knockout');
    expect(hero.isKnockedOut).toBe(false);
    expect(hero.hp).toBe(1);
  });

  it('knockout clears other states', () => {
    const hero = new Actor(db, 'hero');
    hero.addState('poison');
    hero.addState('knockout');
    expect(hero.states.map((s) => s.id)).toEqual(['knockout']);
  });

  it('sorts states by priority and gives them countdowns', () => {
    const hero = new Actor(db, 'hero');
    hero.addState('poison'); // priority 50, 40 steps
    hero.addState('sleep', () => 0.99); // priority 60, 2-4 turns
    expect(hero.states).toEqual([
      { id: 'sleep', turns: 4 },
      { id: 'poison', steps: 40 },
    ]);
  });

  it('reads state and equipment modifiers for rates', () => {
    const hero = new Actor(db, 'hero');
    hero.addState('poison');
    expect(hero.hpRegenRate()).toBeCloseTo(-0.1);
    expect(hero.stateRate('poison')).toBe(1);
    expect(hero.elementRate('fire')).toBe(1);
  });

  it('exposes formula values', () => {
    const hero = new Actor(db, 'hero');
    expect(hero.formulaValue('attack')).toBe(24);
    expect(hero.formulaValue('level')).toBe(1);
    expect(hero.formulaValue('hp')).toBe(hero.hp);
  });

  it('round-trips through plain data', () => {
    const mira = new Actor(db, 'mira');
    mira.gainExp(500);
    mira.learnSkill('power-strike');
    mira.setHp(42);
    mira.setMp(7);
    mira.addState('poison');
    const data = mira.toData();
    expect(JSON.parse(JSON.stringify(data))).toEqual(data); // plain JSON
    const copy = Actor.fromData(db, data);
    expect(copy.toData()).toEqual(data);
    expect(copy.skills).toEqual(mira.skills);
    expect(copy.stats()).toEqual(mira.stats());
  });
});
