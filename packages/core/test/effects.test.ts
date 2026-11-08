import type { ItemEntry, SkillEntry } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  Actor,
  CRITICAL_MULTIPLIER,
  DatabaseIndex,
  GameState,
  Party,
  REGEN_STEP_INTERVAL,
  applyUsable,
  resolveTargets,
  useItem,
  useSkill,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const db = demoDb();
const skill = (id: string): SkillEntry => db.skills.get(id);
const item = (id: string): ItemEntry => db.items.get(id);

/** A random source that replays a fixed sequence (then repeats the last value). */
function sequence(...values: number[]) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)] ?? 0.5;
}
const ctx = (random = () => 0.5) => ({ state: new GameState(), random });

/** A level 30 warrior and a level 50 warrior with HP to spare: hits land without killing. */
function strongVsTank() {
  const attacker = new Actor(db, 'hero');
  attacker.changeLevel(30);
  const tank = new Actor(db, 'hero');
  tank.changeLevel(50);
  tank.recoverAll();
  return { attacker, tank };
}

describe('damage', () => {
  it('evaluates the formula with no variance at the midpoint roll', () => {
    const hero = new Actor(db, 'hero'); // attack 24
    const mira = new Actor(db, 'mira');
    const [result] = applyUsable(skill('attack'), hero, [mira], ctx());
    const expected = 24 * 4 - mira.stat('defense') * 2;
    expect(result?.hpDamage).toBe(expected);
    expect(mira.hp).toBe(mira.maxHp - expected);
  });

  it('applies variance within ±variance', () => {
    const hero = new Actor(db, 'hero');
    const target = () => new Actor(db, 'mira');
    // success roll, then variance roll 0 (−20%) or ~1 (+20%), then crit roll (no crit)
    const low = applyUsable(skill('attack'), hero, [target()], ctx(sequence(0, 0, 0.9)))[0];
    const high = applyUsable(skill('attack'), hero, [target()], ctx(sequence(0, 0.9999, 0.9)))[0];
    const base = 24 * 4 - target().stat('defense') * 2;
    expect(low?.hpDamage).toBe(Math.round(base * 0.8));
    expect(high?.hpDamage).toBe(Math.round(base * 1.19996));
  });

  it('can land a critical hit', () => {
    const { attacker, tank } = strongVsTank();
    const base = attacker.stat('attack') * 4 - tank.stat('defense') * 2;
    expect(base).toBeGreaterThan(0);
    const [result] = applyUsable(skill('attack'), attacker, [tank], ctx(sequence(0, 0.5, 0)));
    expect(result?.critical).toBe(true);
    expect(result?.hpDamage).toBe(base * CRITICAL_MULTIPLIER);
  });

  it('applies element rates, including the user attack element', () => {
    const data = db.data;
    const slime = data.enemies.find((e) => e.id === 'slime');
    expect(slime?.modifiers).toContainEqual({ type: 'elementRate', element: 'fire', value: 1.5 });
    // An actor weak to fire via a temporary state:
    const weak = {
      id: 'weak-fire',
      name: 'Weak to fire',
      priority: 1,
      restriction: 'none' as const,
      knockout: false,
      removal: { battleEnd: true },
      modifiers: [{ type: 'elementRate' as const, element: 'fire', value: 2 }],
    };
    const db2 = new DatabaseIndex({ ...data, states: [...data.states, weak] });
    const mira = new Actor(db2, 'mira');
    const hero = new Actor(db2, 'hero');
    hero.changeLevel(30);
    const normal = applyUsable(db2.skills.get('fire'), mira, [hero], ctx())[0]?.hpDamage ?? 0;
    hero.recoverAll();
    hero.addState('weak-fire');
    const doubled = applyUsable(db2.skills.get('fire'), mira, [hero], ctx())[0]?.hpDamage ?? 0;
    expect(doubled).toBe(normal * 2);
  });

  it('never heals by dealing negative damage', () => {
    const mira = new Actor(db, 'mira');
    const hero = new Actor(db, 'hero');
    hero.changeLevel(99); // defense far above Mira's attack
    const before = hero.hp;
    const [result] = applyUsable(skill('attack'), mira, [hero], ctx());
    expect(result?.hpDamage).toBe(0);
    expect(hero.hp).toBe(before);
  });

  it('reports a knockout and wakes sleepers when hit', () => {
    const { attacker, tank } = strongVsTank();
    const mira = new Actor(db, 'mira');
    mira.addState('sleep');
    const [hit] = applyUsable(
      skill('power-strike'),
      attacker,
      [mira],
      ctx(sequence(0, 0.5, 0.9, 0)),
    );
    expect(hit?.addedStates).toEqual(['knockout']);
    expect(mira.isKnockedOut).toBe(true);

    tank.addState('sleep');
    const [nudge] = applyUsable(skill('attack'), attacker, [tank], ctx(sequence(0, 0.5, 0.9, 0)));
    expect(nudge?.hpDamage).toBeGreaterThan(0);
    expect(tank.isKnockedOut).toBe(false);
    expect(nudge?.removedStates).toEqual(['sleep']);
  });

  it('misses on a failed success roll', () => {
    const hero = new Actor(db, 'hero');
    const mira = new Actor(db, 'mira');
    const [result] = applyUsable(skill('power-strike'), hero, [mira], ctx(sequence(0.99)));
    expect(result?.missed).toBe(true);
    expect(mira.hp).toBe(mira.maxHp);
  });
});

describe('recovery and states', () => {
  it('heals up to max HP and reports it as negative damage', () => {
    const mira = new Actor(db, 'mira');
    const hero = new Actor(db, 'hero');
    hero.setHp(10);
    const [result] = applyUsable(skill('heal'), mira, [hero], ctx());
    expect(hero.hp).toBe(hero.maxHp);
    expect(result?.hpDamage).toBe(-(hero.maxHp - 10));
  });

  it('uses max() in the potion formula', () => {
    const hero = new Actor(db, 'hero'); // max HP 120: 30% is 36, so 100 wins
    hero.setHp(1);
    applyUsable(item('potion'), hero, [hero], ctx());
    expect(hero.hp).toBe(101);
  });

  it('revives with the revive leaf (remove knockout, then heal)', () => {
    const hero = new Actor(db, 'hero');
    hero.setHp(0);
    const [result] = applyUsable(item('revive-leaf'), hero, [hero], ctx());
    expect(hero.isKnockedOut).toBe(false);
    // Removing knockout revives at 1 HP; the leaf then heals 25% of max HP.
    expect(hero.hp).toBe(1 + Math.round(hero.maxHp * 0.25));
    expect(result?.removedStates).toEqual(['knockout']);
  });

  it('respects state resistance when adding states', () => {
    const party = Party.start(db, { party: ['hero'], gold: 0 });
    const hero = party.member('hero');
    if (!hero) throw new Error('fixture');
    const poisonDart: ItemEntry = {
      ...item('antidote'),
      id: 'dart',
      effects: [{ type: 'addState', state: 'poison', chance: 1 }],
    };
    applyUsable(poisonDart, hero, [hero], ctx());
    expect(hero.hasState('poison')).toBe(true);
    hero.removeState('poison');
    party.gain('equipment', 'lucky-charm', 1);
    party.equip('hero', 'accessory', 'lucky-charm'); // poison rate 0
    const [result] = applyUsable(poisonDart, hero, [hero], ctx());
    expect(result?.addedStates).toEqual([]);
    expect(hero.hasState('poison')).toBe(false);
  });

  it('cures with removeState', () => {
    const hero = new Actor(db, 'hero');
    hero.addState('poison');
    applyUsable(item('antidote'), hero, [hero], ctx());
    expect(hero.hasState('poison')).toBe(false);
  });
});

describe('targets', () => {
  const allies = () => [new Actor(db, 'hero'), new Actor(db, 'mira')];

  it('resolves user, all, chosen and dead scopes', () => {
    const [hero, mira] = allies();
    if (!hero || !mira) throw new Error('fixture');
    const team = [hero, mira];
    mira.setHp(0);
    const r = () => 0;
    expect(resolveTargets({ side: 'user' }, hero, team, [], r)).toEqual([hero]);
    expect(resolveTargets({ side: 'none' }, hero, team, [], r)).toEqual([]);
    expect(resolveTargets({ side: 'ally', select: 'all' }, hero, team, [], r)).toEqual([hero]);
    expect(resolveTargets({ side: 'ally', select: 'one', dead: true }, hero, team, [], r)).toEqual([
      mira,
    ]);
    expect(resolveTargets({ side: 'ally', select: 'one' }, hero, team, [], r, mira)).toEqual([
      hero,
    ]);
  });

  it('picks random targets among the living', () => {
    const [hero, mira] = allies();
    if (!hero || !mira) throw new Error('fixture');
    const picks = resolveTargets(
      { side: 'enemy', select: 'random', count: 3 },
      hero,
      [],
      [hero, mira],
      sequence(0, 0.9, 0.4),
    );
    expect(picks).toEqual([hero, mira, hero]);
  });
});

describe('useSkill / useItem', () => {
  it('pays MP and refuses when it cannot be used', () => {
    const mira = new Actor(db, 'mira');
    const hero = new Actor(db, 'hero');
    const mpBefore = mira.mp;
    useSkill(mira, skill('heal'), [hero], 'menu', ctx());
    expect(mira.mp).toBe(mpBefore - 4);
    expect(() => useSkill(mira, skill('fire'), [hero], 'menu', ctx())).toThrow(/in the menu/);
    expect(() => useSkill(hero, skill('heal'), [hero], 'menu', ctx())).toThrow(/doesn't know/);
    mira.setMp(0);
    expect(() => useSkill(mira, skill('heal'), [hero], 'menu', ctx())).toThrow(/not enough MP/);
    mira.setMp(99);
    mira.addState('sleep');
    expect(() => useSkill(mira, skill('heal'), [hero], 'menu', ctx())).toThrow(/can't act/);
  });

  it('consumes consumable items and refuses when none are left', () => {
    const party = Party.start(db, { party: ['hero'], gold: 0 });
    const hero = party.member('hero');
    if (!hero) throw new Error('fixture');
    party.gain('item', 'potion', 1);
    hero.setHp(1);
    useItem(party, hero, item('potion'), [hero], 'menu', ctx());
    expect(party.count('item', 'potion')).toBe(0);
    expect(() => useItem(party, hero, item('potion'), [hero], 'menu', ctx())).toThrow(/none left/);
    party.gain('item', 'meadow-map', 1);
    expect(() => useItem(party, hero, item('meadow-map'), [], 'menu', ctx())).toThrow(
      /in the menu/,
    );
  });
});

describe('state countdowns and regeneration', () => {
  it('counts down turn states and removes them', () => {
    const hero = new Actor(db, 'hero');
    hero.addState('sleep', () => 0); // 2 turns
    expect(hero.canAct).toBe(false);
    expect(hero.tickTurn()).toEqual([]);
    expect(hero.tickTurn()).toEqual(['sleep']);
    expect(hero.canAct).toBe(true);
  });

  it('removes battle-end states', () => {
    const hero = new Actor(db, 'hero');
    hero.addState('sleep');
    hero.addState('poison');
    expect(hero.onBattleEnd()).toEqual(['sleep']);
    expect(hero.hasState('poison')).toBe(true);
  });

  it('poisons on the map every 20 steps but never below 1 HP, then wears off', () => {
    const party = Party.start(db, { party: ['hero'], gold: 0 });
    const hero = party.member('hero');
    if (!hero) throw new Error('fixture');
    hero.addState('poison'); // -10% max HP per tick, wears off after 40 steps
    hero.setHp(20);
    let last;
    for (let i = 0; i < REGEN_STEP_INTERVAL; i++) last = party.onStep();
    expect(hero.hp).toBe(8); // 20 - 12
    expect(last?.regen.get('hero')).toBe(-12);
    for (let i = 0; i < REGEN_STEP_INTERVAL - 1; i++) party.onStep();
    expect(hero.hp).toBe(8);
    const final = party.onStep(); // step 40: poison ticks to 1 HP min, then... order check
    expect(hero.hp).toBeGreaterThanOrEqual(1);
    expect(hero.isKnockedOut).toBe(false);
    expect(final.expired.get('hero')).toEqual(['poison']);
    expect(party.steps).toBe(40);
  });
});
