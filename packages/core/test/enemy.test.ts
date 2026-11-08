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
    const wolf = new Enemy(db, 'wolf'); // attack 5, power-strike 2 (5 MP)
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
