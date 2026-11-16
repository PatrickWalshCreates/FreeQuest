// M14 step 7: TP, buffs and debuffs, skills that hit several times, common-event
// effects, and troops' battle events.
import type { Database, SkillEntry, TroopEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  Battle,
  DatabaseIndex,
  GameState,
  MAX_TP,
  Party,
  applyUsable,
  commonEventsOf,
  skillProblem,
  useSkill,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const base = demoDb().data;

const skill = (id: string, extra: Partial<SkillEntry>): SkillEntry => ({
  id,
  name: id,
  mpCost: 0,
  occasion: 'always',
  target: { side: 'enemy', select: 'one' },
  hitType: 'certain',
  successRate: 1,
  effects: [],
  ...extra,
});

/** The demo's database with extra skills and battle events for the slimes. */
function database(skills: SkillEntry[] = [], events: TroopEvent[] = []): DatabaseIndex {
  const data: Database = {
    ...base,
    skills: [...base.skills, ...skills],
    troops: base.troops.map((t) => (t.id === 'slimes' ? { ...t, events } : t)),
  };
  return new DatabaseIndex(data);
}

function battle(db: DatabaseIndex, state = new GameState()) {
  const party = Party.start(db, { party: ['hero'], gold: 0 });
  const hero = party.members[0];
  if (!hero) throw new Error('no hero');
  hero.changeLevel(20);
  hero.recoverAll();
  // The hero knows every skill, so tests can use any.
  for (const entry of db.skills.all) if (!hero.hasSkill(entry.id)) hero.learnSkill(entry.id);
  const fight = new Battle({
    db,
    party,
    troop: 'slimes',
    state,
    canEscape: true,
    random: () => 0.5,
  });
  return { fight, hero, party };
}

describe('TP', () => {
  it('starts at 0 each battle, is gained by taking damage and from actions, and pays costs', () => {
    const db = database([
      skill('charge', { tpGain: 30, effects: [] }),
      skill('finisher', {
        tpCost: 40,
        effects: [{ type: 'damage', pool: 'hp', formula: '10', variance: 0, critical: false }],
      }),
    ]);
    const { fight, hero } = battle(db);
    hero.setTp(80);
    // A new battle starts from 0.
    const { hero: fresh } = battle(db);
    expect(fresh.tp).toBe(0);
    expect(hero.tp).toBe(80);
    const finisher = db.skills.get('finisher');
    expect(skillProblem(fresh, finisher, 'battle')).toBe('not enough TP');
    const ctx = { state: new GameState(), random: () => 0.5, inBattle: true };
    useSkill(fresh, db.skills.get('charge'), [fresh], 'battle', ctx);
    useSkill(fresh, db.skills.get('charge'), [fresh], 'battle', ctx);
    expect(fresh.tp).toBe(60);
    useSkill(fresh, finisher, [fight.enemies[0] ?? fresh], 'battle', ctx);
    expect(fresh.tp).toBe(20);
    // Losing a quarter of one's HP gives a quarter of 50 TP.
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    const quarter = Math.floor(fresh.maxHp / 4);
    applyUsable(
      skill('hit', {
        effects: [
          { type: 'damage', pool: 'hp', formula: String(quarter), variance: 0, critical: false },
        ],
      }),
      enemy,
      [fresh],
      ctx,
    );
    expect(fresh.tp).toBe(20 + Math.floor((50 * quarter) / fresh.maxHp));
    fresh.setTp(500);
    expect(fresh.tp).toBe(MAX_TP);
  });

  it('isn’t gained outside battles (menus)', () => {
    const db = database([skill('charge', { tpGain: 30 })]);
    const { hero } = battle(db);
    useSkill(hero, db.skills.get('charge'), [hero], 'menu', {
      state: new GameState(),
      random: () => 0.5,
    });
    expect(hero.tp).toBe(0);
  });
});

describe('buffs and debuffs', () => {
  it('change a stat by 25% a level, up to two, and wear off', () => {
    const db = database();
    const { hero } = battle(db);
    const attack = hero.stat('attack');
    hero.addBuff('attack', 1, 2);
    expect(hero.stat('attack')).toBe(Math.round(attack * 1.25));
    hero.addBuff('attack', 1, 2);
    hero.addBuff('attack', 1, 2);
    expect(hero.buffLevel('attack')).toBe(2);
    expect(hero.stat('attack')).toBe(Math.round(attack * 1.5));
    hero.addBuff('defense', -1, 1);
    expect(hero.tickBuffs()).toEqual(['defense']);
    expect(hero.tickBuffs()).toEqual(['attack']);
    expect(hero.stat('attack')).toBe(attack);
  });

  it('come from effects, show in results, and end with the battle', () => {
    const db = database([
      skill('war-cry', {
        target: { side: 'user' },
        effects: [{ type: 'buff', stat: 'attack', direction: 'up', turns: 3 }],
      }),
    ]);
    const { fight, hero } = battle(db);
    const [result] = useSkill(hero, db.skills.get('war-cry'), [hero], 'battle', {
      state: new GameState(),
      random: () => 0.5,
      inBattle: true,
    });
    expect(result?.buffs).toEqual([{ stat: 'attack', change: 1 }]);
    expect(hero.buffLevel('attack')).toBe(1);
    hero.onBattleEnd();
    expect(hero.buffLevel('attack')).toBe(0);
    expect(fight.phase).toBe('input');
  });
});

describe('repeats', () => {
  it('hit each target that many times, paying once', () => {
    const db = database([
      skill('double', {
        mpCost: 2,
        repeats: 2,
        effects: [{ type: 'damage', pool: 'hp', formula: '5', variance: 0, critical: false }],
      }),
    ]);
    const { fight, hero } = battle(db);
    const enemy = fight.enemies[0];
    if (!enemy) throw new Error('no enemy');
    const mp = hero.mp;
    const results = useSkill(hero, db.skills.get('double'), [enemy], 'battle', {
      state: new GameState(),
      random: () => 0.5,
      inBattle: true,
    });
    expect(results.map((r) => r.hpDamage)).toEqual([5, 5]);
    expect(hero.mp).toBe(mp - 2);
  });
});

describe('common-event effects', () => {
  it('run once a use is over, unless it missed everyone', () => {
    const flare = skill('flare', { effects: [{ type: 'commonEvent', common: 'rest' }] });
    const hit = { missed: false } as Parameters<typeof commonEventsOf>[1][number];
    expect(commonEventsOf(flare, [hit, hit])).toEqual(['rest']);
    expect(commonEventsOf(flare, [{ ...hit, missed: true }])).toEqual([]);
    expect(commonEventsOf(flare, [])).toEqual(['rest']);
  });

  it('come out of a battle turn as an event to run', () => {
    const db = database([
      skill('flare', {
        effects: [
          { type: 'damage', pool: 'hp', formula: '1', variance: 0, critical: false },
          { type: 'commonEvent', common: 'rest' },
        ],
      }),
    ]);
    const { fight, hero } = battle(db);
    fight.setAction(hero, { kind: 'skill', skill: 'flare', target: fight.enemies[0] ?? hero });
    const events = fight.runTurn();
    expect(events.filter((e) => e.type === 'commonEvent')).toEqual([
      { type: 'commonEvent', common: 'rest' },
    ]);
  });
});

describe('troop battle events', () => {
  const said = (text: string) => [{ type: 'message' as const, text }];

  it('are due by turn, once a battle, once a turn or every time', () => {
    const db = database(
      [],
      [
        { conditions: { turn: { from: 1, every: 0 } }, span: 'battle', commands: said('first') },
        { conditions: { turn: { from: 1, every: 1 } }, span: 'turn', commands: said('every') },
        {
          conditions: { turn: { from: 2, every: 2 }, turnEnd: true },
          span: 'turn',
          commands: said('even ends'),
        },
        { conditions: {}, span: 'moment', commands: said('never') },
      ],
    );
    const { fight, hero } = battle(db);
    const texts = (lists: readonly (readonly { type: string; text?: string }[])[]) =>
      lists.map((l) => l[0]?.text);
    expect(texts(fight.dueEvents('turnStart'))).toEqual(['first', 'every']);
    // Checked again in the same turn: nothing new.
    expect(texts(fight.dueEvents('turnStart'))).toEqual([]);
    fight.setAction(hero, { kind: 'skill', skill: 'guard' });
    fight.runTurn();
    expect(texts(fight.dueEvents('turnEnd'))).toEqual([]);
    expect(texts(fight.dueEvents('turnStart'))).toEqual(['every']);
    fight.setAction(hero, { kind: 'skill', skill: 'guard' });
    fight.runTurn();
    expect(texts(fight.dueEvents('turnEnd'))).toEqual(['even ends']);
  });

  it('test enemies’ and actors’ HP and switches', () => {
    const state = new GameState({
      switches: [{ id: 'rage', name: 'Rage' }],
      variables: [],
    });
    const db = database(
      [],
      [
        {
          conditions: { enemyHp: { enemy: 1, below: 50 } },
          span: 'moment',
          commands: said('hurt'),
        },
        {
          conditions: { actorHp: { actor: 'hero', below: 30 } },
          span: 'battle',
          commands: said('low'),
        },
        { conditions: { switch: 'rage' }, span: 'battle', commands: said('rage') },
      ],
    );
    const { fight, hero } = battle(db, state);
    const texts = () => fight.dueEvents('turnStart').map((l) => (l[0] as { text: string }).text);
    expect(texts()).toEqual([]);
    const second = fight.enemies[1];
    if (!second) throw new Error('no second slime');
    second.setHp(Math.floor(second.maxHp / 2));
    hero.setHp(Math.floor(hero.maxHp / 4));
    state.setSwitch('rage', true);
    expect(texts()).toEqual(['hurt', 'low', 'rage']);
    // "Every time" runs again; once-a-battle ones don't.
    expect(texts()).toEqual(['hurt']);
  });

  it('end the battle when what they do ends it', () => {
    const { fight, hero } = battle(database());
    expect(fight.checkOutcome()).toEqual([]);
    hero.setHp(0);
    expect(fight.checkOutcome()).toEqual([{ type: 'defeat' }]);
    expect(fight.phase).toBe('lost');
    expect(fight.dueEvents('turnStart')).toEqual([]);
  });
});
