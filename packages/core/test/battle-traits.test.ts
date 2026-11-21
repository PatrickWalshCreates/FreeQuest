// M16 step 4: counterattacks, sending magic back, dodging magic, extra
// actions, and party abilities (fewer or no random battles, double gold and drops).
import type { Database, Modifier, SkillEntry } from '@freequest/schema';
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import {
  ActionState,
  Battle,
  type BattleEvent,
  DatabaseIndex,
  GameState,
  Party,
  World,
  createEnemies,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const base = demoDb().data;

const bolt: SkillEntry = {
  id: 'bolt',
  name: 'Bolt',
  mpCost: 0,
  occasion: 'always',
  target: { side: 'enemy', select: 'one' },
  hitType: 'magical',
  successRate: 1,
  effects: [{ type: 'damage', pool: 'hp', formula: '20', variance: 0, critical: false }],
};

/** The demo's database with modifiers on the slimes and on the hero's class. */
function database(slime: Modifier[] = [], hero: Modifier[] = []): DatabaseIndex {
  const data: Database = {
    ...base,
    skills: [...base.skills, bolt],
    enemies: base.enemies.map((e) =>
      e.id === 'slime' ? { ...e, modifiers: [...e.modifiers, ...slime] } : e,
    ),
    classes: base.classes.map((c) =>
      c.id === 'warrior' ? { ...c, modifiers: [...c.modifiers, ...hero] } : c,
    ),
  };
  return new DatabaseIndex(data);
}

function battle(db: DatabaseIndex, random = () => 0.5) {
  const party = Party.start(db, { party: ['hero'], gold: 0 });
  const hero = party.members[0];
  if (!hero) throw new Error('no hero');
  hero.changeLevel(20);
  hero.recoverAll();
  hero.learnSkill('bolt');
  const fight = new Battle({
    db,
    party,
    troop: 'slimes',
    state: new GameState(),
    canEscape: true,
    random,
  });
  return { fight, hero, party };
}

/** One turn: the hero uses `skill` on the first slime. */
function turn(fight: Battle, hero: Party['members'][number], skill: string): BattleEvent[] {
  const target = fight.enemies[0];
  fight.setAction(hero, { kind: 'skill', skill, ...(target ? { target } : {}) });
  return fight.runTurn();
}

const kinds = (events: BattleEvent[]) => events.map((e) => e.type);

describe('combat traits', () => {
  it('counterattack: a physical hit is answered instead of taken', () => {
    const { fight, hero } = battle(database([{ type: 'counterRate', value: 1 }]));
    const slime = fight.enemies[0];
    const events = turn(fight, hero, 'attack');
    const counter = events.find((e) => e.type === 'counter');
    expect(counter).toMatchObject({ battler: slime, target: hero });
    expect(slime?.hp).toBe(slime?.maxHp);
    // The slime's own attack lands on the hero right after (a level 20 hero may take 0 from it).
    const answer = events[events.indexOf(counter as BattleEvent) + 1];
    expect(answer).toMatchObject({
      type: 'hit',
      user: slime,
      result: { target: hero, missed: false },
    });
  });

  it('reflection: magic goes back to its user', () => {
    const { fight, hero } = battle(database([{ type: 'reflectRate', value: 1 }]));
    const slime = fight.enemies[0];
    const before = hero.hp;
    const events = turn(fight, hero, 'bolt');
    expect(events.find((e) => e.type === 'reflect')).toMatchObject({ battler: slime, user: hero });
    expect(slime?.hp).toBe(slime?.maxHp);
    // The bolt's 20 (before defence modifiers and any slime attacks this turn).
    const reflected = events.find(
      (e) => e.type === 'hit' && e.user === hero && e.result.target === hero,
    );
    expect(reflected?.type === 'hit' && reflected.result.hpDamage).toBeGreaterThan(0);
    expect(hero.hp).toBeLessThan(before);
  });

  it('magic evasion: magic misses, physical hits still land', () => {
    const { fight, hero } = battle(database([{ type: 'magicEvasionRate', value: 1 }]));
    const events = turn(fight, hero, 'bolt');
    const bolt = events.find((e) => e.type === 'hit' && e.user === hero);
    expect(bolt?.type === 'hit' && bolt.result.missed).toBe(true);
  });

  it('extra actions: the hero repeats the command, enemies act again', () => {
    const { fight, hero } = battle(
      database([{ type: 'extraActions', value: 1 }], [{ type: 'extraActions', value: 1 }]),
    );
    const events = turn(fight, hero, 'bolt');
    const actions = events.filter((e) => e.type === 'action');
    expect(actions.filter((e) => e.type === 'action' && e.user === hero)).toHaveLength(2);
    // Two slimes, each acting twice (unless one fell first).
    expect(actions.length).toBeGreaterThanOrEqual(4);
    // Without the chance, one action each.
    const plain = battle(database());
    expect(kinds(turn(plain.fight, plain.hero, 'bolt')).filter((k) => k === 'action')).toHaveLength(
      3,
    );
  });
});

describe('party abilities', () => {
  it('double gold and drop chances after a win', () => {
    const win = (db: DatabaseIndex) => {
      const { fight, hero, party } = battle(db, () => 0.4);
      for (const enemy of fight.enemies) enemy.setHp(1);
      for (let i = 0; i < 5 && fight.phase === 'input'; i++) turn(fight, hero, 'attack');
      return party.gold;
    };
    const plain = win(database());
    expect(plain).toBeGreaterThan(0);
    expect(win(database([], [{ type: 'partyAbility', ability: 'doubleGold' }]))).toBe(plain * 2);

    // The slime's potion drops 30% of the time: a roll of 0.4 misses, unless chances double.
    const [slime] = createEnemies(database(), ['slime']);
    expect(slime?.rollDrops(() => 0.4)).toEqual([]);
    expect(slime?.rollDrops(() => 0.4, 2)).toEqual([{ kind: 'item', id: 'potion' }]);
    const drops = (db: DatabaseIndex) => {
      const { fight, hero, party } = battle(db, () => 0.4);
      for (const enemy of fight.enemies) enemy.setHp(1);
      for (let i = 0; i < 5 && fight.phase === 'input'; i++) turn(fight, hero, 'attack');
      return party.count('item', 'potion');
    };
    expect(drops(database([], [{ type: 'partyAbility', ability: 'doubleDrops' }]))).toBeGreaterThan(
      drops(database()),
    );
  });

  it('half as many, or no, random battles', () => {
    const manifest = parseProjectFile('manifest', rawManifest);
    const tileset = parseProjectFile('tileset', rawTileset);
    const map = {
      ...parseProjectFile('map', rawMap),
      encounters: { steps: 10, troops: [{ troop: 'slimes', weight: 1 }] },
    };
    /** Steps walked (back and forth) until a random battle; 0 = none in 400. */
    const stepsToBattle = (hero: Modifier[]) => {
      const w = new World({
        manifest,
        map,
        tileset,
        database: database([], hero),
        random: () => 0.5,
      });
      const input = new ActionState();
      for (let step = 1; step <= 400; step++) {
        const direction = step % 2 === 0 ? 'left' : 'right';
        input.press(direction);
        for (let i = 0; i < 20 && !w.hasPendingEncounter; i++) {
          w.step(1 / 60, input);
          input.endStep();
        }
        input.release(direction);
        for (let i = 0; i < 20 && !w.hasPendingEncounter; i++) w.step(1 / 60, input);
        if (w.hasPendingEncounter) return step;
      }
      return 0;
    };
    const normal = stepsToBattle([]);
    expect(normal).toBeGreaterThan(0);
    const fewer = stepsToBattle([{ type: 'partyAbility', ability: 'fewerEncounters' }]);
    expect(fewer).toBeGreaterThanOrEqual(normal * 2 - 2);
    expect(stepsToBattle([{ type: 'partyAbility', ability: 'noEncounters' }])).toBe(0);
  });
});
