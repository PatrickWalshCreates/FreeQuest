import type { EnemyCondition, EnemyEntry } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { Actor, Enemy, GameState, applyUsable, createEnemies } from '../src/index.js';
import { demoDb } from './demo-db.js';

const db = demoDb();
const ctx = () => ({ state: new GameState(), random: () => 0.5 });

describe('Enemy', () => {
  it('uses its database stats and starts at full HP/MP', () => {
    const wolf = new Enemy(db, 'wolf');
    expect(wolf.stats()).toEqual(db.enemies.get('wolf').stats);
    expect([wolf.hp, wolf.mp]).toEqual([90, 20]);
    expect(wolf.level).toBe(1);
  });

  it('takes element weaknesses from its modifiers', () => {
    const mira = new Actor(db, 'mira');
    const slime = new Enemy(db, 'slime');
    const bat = new Enemy(db, 'bat');
    const vsSlime = applyUsable(db.skills.get('fire'), mira, [slime], ctx())[0]?.hpDamage ?? 0;
    const vsBat = applyUsable(db.skills.get('fire'), mira, [bat], ctx())[0]?.hpDamage ?? 0;
    const raw = 100 + mira.stat('magicAttack') * 2;
    expect(vsSlime).toBe(Math.min(60, Math.round((raw - 6 * 2) * 1.5)));
    expect(vsBat).toBe(Math.min(40, raw - 8 * 2));
  });

  it('can be knocked out like anyone else', () => {
    const slime = new Enemy(db, 'slime');
    slime.setHp(0);
    expect(slime.isKnockedOut).toBe(true);
    expect(slime.chooseAction(() => 0)).toBeNull();
  });

  it('rolls each drop independently', () => {
    const slime = new Enemy(db, 'slime'); // potion at 30%
    expect(slime.rollDrops(() => 0.1)).toEqual([{ kind: 'item', id: 'potion' }]);
    expect(slime.rollDrops(() => 0.5)).toEqual([]);
    expect(new Enemy(db, 'wolf').rollDrops(() => 0)).toEqual([
      { kind: 'equipment', id: 'straw-hat' },
    ]);
  });

  it('picks actions weighted by rating, skipping ones it cannot afford', () => {
    // attack 5, power-strike 2 (5 MP), both always allowed
    const wolf = new Enemy(db, 'wolf');
    Object.defineProperty(wolf, 'entry', {
      value: {
        ...wolf.entry,
        actions: [
          { skill: 'attack', rating: 5, conditions: [] },
          { skill: 'power-strike', rating: 2, conditions: [] },
        ],
      },
    });
    expect(wolf.chooseAction(() => 0)).toBe('attack');
    expect(wolf.chooseAction(() => 0.7)).toBe('attack'); // 0.7 * 7 = 4.9 < 5
    expect(wolf.chooseAction(() => 0.72)).toBe('power-strike'); // 5.04 ≥ 5
    wolf.setMp(0);
    expect(wolf.chooseAction(() => 0.99)).toBe('attack');
  });

  it('exposes rewards', () => {
    const wolf = new Enemy(db, 'wolf');
    expect([wolf.exp, wolf.gold]).toEqual([14, 18]);
  });
});

describe('createEnemies', () => {
  it('letters duplicates and leaves unique enemies unlettered', () => {
    const names = createEnemies(db, ['slime', 'bat', 'slime', 'slime']).map((e) => e.name);
    expect(names).toEqual(['Slime A', 'Bat', 'Slime B', 'Slime C']);
  });
});

describe('action conditions', () => {
  /** A wolf with its own list of actions (a copy: the shared database stays as it is). */
  function wolfWith(actions: EnemyEntry['actions']): Enemy {
    const wolf = new Enemy(db, 'wolf');
    Object.defineProperty(wolf, 'entry', { value: { ...wolf.entry, actions } });
    return wolf;
  }
  const act = (skill: string, ...conditions: EnemyCondition[]) => ({
    skill,
    rating: 5,
    conditions,
  });

  it('checks HP shares, turn numbers and states', () => {
    const wolf = new Enemy(db, 'wolf');
    wolf.setHp(Math.floor(wolf.maxHp * 0.4));
    expect(wolf.meets({ type: 'hp', compare: 'below', percent: 50 }, 1)).toBe(true);
    expect(wolf.meets({ type: 'hp', compare: 'atLeast', percent: 50 }, 1)).toBe(false);
    const turns = (from: number, every: number) =>
      [1, 2, 3, 4, 5, 6, 7, 8].filter((t) => wolf.meets({ type: 'turn', from, every }, t));
    expect(turns(2, 3)).toEqual([2, 5, 8]);
    expect(turns(3, 0)).toEqual([3]);
    expect(turns(1, 1)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(wolf.meets({ type: 'state', state: 'poison', has: false }, 1)).toBe(true);
    wolf.addState('poison');
    expect(wolf.meets({ type: 'state', state: 'poison', has: true }, 1)).toBe(true);
  });

  it('only picks actions whose conditions hold', () => {
    const wolf = wolfWith([
      act('attack'),
      act('power-strike', { type: 'hp', compare: 'below', percent: 50 }),
    ]);
    // Always the last option when random is high: only attack qualifies at full HP.
    expect(wolf.chooseAction(() => 0.99, 1)).toBe('attack');
    wolf.setHp(10);
    expect(wolf.chooseAction(() => 0.99, 1)).toBe('power-strike');
  });

  it('does nothing when no action qualifies', () => {
    const wolf = wolfWith([act('power-strike', { type: 'turn', from: 3, every: 0 })]);
    expect(wolf.chooseAction(() => 0.5, 1)).toBeNull();
    expect(wolf.chooseAction(() => 0.5, 3)).toBe('power-strike');
  });
});
