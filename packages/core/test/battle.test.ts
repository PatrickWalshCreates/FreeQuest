import { describe, expect, it } from 'vitest';
import {
  type Actor,
  Battle,
  type BattleEvent,
  type Battler,
  GameState,
  MAX_BATTLE_MEMBERS,
  Party,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const db = demoDb();

/** Small seeded PRNG (mulberry32) so whole battles are reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(
  troop: string,
  {
    members = ['hero', 'mira'],
    levels = {} as Record<string, number>,
    canEscape = true,
    random = seeded(1),
  } = {},
) {
  const party = Party.start(db, { party: members, gold: 0 });
  for (const [id, level] of Object.entries(levels)) {
    party.member(id)?.changeLevel(level);
    party.member(id)?.recoverAll();
  }
  const battle = new Battle({ db, party, troop, state: new GameState(), canEscape, random });
  const actor = (id: string): Actor => {
    const a = party.member(id);
    if (!a) throw new Error(id);
    return a;
  };
  /** Everyone commandable attacks the first living enemy. */
  const attackAll = () => {
    for (const a of battle.actorsToCommand()) {
      const target: Battler | undefined = battle.livingEnemies[0];
      battle.setAction(a, { kind: 'skill', skill: 'attack', ...(target ? { target } : {}) });
    }
    return battle.runTurn();
  };
  return { party, battle, actor, attackAll };
}

const types = (events: readonly BattleEvent[]) => events.map((e) => e.type);

describe('Battle setup', () => {
  it('fields the front party members against the lettered troop', () => {
    const { battle } = setup('slimes');
    expect(battle.actors.map((a) => a.id)).toEqual(['hero', 'mira']);
    expect(battle.enemies.map((e) => e.name)).toEqual(['Slime A', 'Slime B']);
    expect(battle.phase).toBe('input');
    expect(MAX_BATTLE_MEMBERS).toBe(4);
  });

  it('rejects actions the actor cannot take', () => {
    const { battle, actor } = setup('slimes');
    expect(() => battle.setAction(actor('hero'), { kind: 'skill', skill: 'heal' })).toThrow(
      /doesn't know/,
    );
    expect(() => battle.setAction(actor('hero'), { kind: 'item', item: 'potion' })).toThrow(
      /none left/,
    );
    expect(() => battle.runTurn()).toThrow(/no action chosen for Hero, Mira/);
  });

  it('loses immediately with a party that is already down', () => {
    const party = Party.start(db, { party: ['hero'], gold: 0 });
    party.member('hero')?.setHp(0);
    const battle = new Battle({
      db,
      party,
      troop: 'slimes',
      state: new GameState(),
      canEscape: true,
    });
    expect(battle.phase).toBe('lost');
  });
});

describe('Battle turns', () => {
  it('wins a fight and hands out exp, gold and drops', () => {
    const { battle, party, attackAll } = setup('slimes', { levels: { hero: 10, mira: 10 } });
    const heroExpBefore = party.member('hero')?.exp ?? 0;
    let events: BattleEvent[] = [];
    for (let turn = 0; turn < 20 && battle.phase === 'input'; turn++) events = attackAll();
    expect(battle.phase).toBe('won');
    const victory = events.at(-1);
    expect(victory).toMatchObject({ type: 'victory', exp: 12, gold: 16 });
    expect(party.member('hero')?.exp).toBe(heroExpBefore + 12);
    expect(party.gold).toBe(16);
    if (victory?.type === 'victory') {
      for (const drop of victory.drops) expect(party.count(drop.kind, drop.id)).toBeGreaterThan(0);
    }
    expect(() => battle.runTurn()).toThrow(/over/);
  });

  it('reports level ups and newly learned skills on victory', () => {
    const { battle, actor, attackAll } = setup('bridge-wolf', {
      members: ['hero'],
      levels: { hero: 2 },
    });
    const hero = actor('hero');
    hero.gainExp((hero.nextLevelExp ?? 0) - hero.exp - 1); // one exp short of level 3
    let events: BattleEvent[] = [];
    for (let turn = 0; turn < 50 && battle.phase === 'input'; turn++) {
      hero.recoverAll(); // keep the hero standing; this test is about the rewards
      events = attackAll();
    }
    expect(battle.phase).toBe('won');
    expect(events.at(-1)).toMatchObject({
      type: 'victory',
      exp: 14,
      levelUps: [{ actor: hero, level: 3, learnedSkills: ['power-strike'] }],
    });
  });

  it('acts in speed order, with Guard always first', () => {
    const { battle, actor } = setup('slimes', { levels: { hero: 30, mira: 1 } });
    battle.setAction(actor('hero'), {
      kind: 'skill',
      skill: 'attack',
      target: battle.enemies[0] as Battler,
    });
    battle.setAction(actor('mira'), { kind: 'skill', skill: 'guard' });
    const actions = battle.runTurn().filter((e) => e.type === 'action');
    expect(actions[0]).toMatchObject({ user: actor('mira'), name: 'Guard' });
    expect(actions[1]).toMatchObject({ user: actor('hero'), name: 'Attack' });
  });

  it('halves damage taken while guarding', () => {
    const damageTo = (guard: boolean) => {
      const { battle, actor } = setup('bridge-wolf', {
        members: ['hero'], // level 1: the wolf's hits get through its defense
        random: () => 0.3,
      });
      battle.setAction(
        actor('hero'),
        guard ? { kind: 'skill', skill: 'guard' } : { kind: 'skill', skill: 'attack' },
      );
      const hits = battle
        .runTurn()
        .filter((e) => e.type === 'hit' && e.result.target === actor('hero'));
      return hits.reduce((sum, e) => sum + (e.type === 'hit' ? e.result.hpDamage : 0), 0);
    };
    const normal = damageTo(false);
    expect(normal).toBeGreaterThan(0);
    // Halved before rounding, so it can differ from round(normal / 2) by one.
    expect(Math.abs(damageTo(true) - normal / 2)).toBeLessThanOrEqual(1);
  });

  it('retargets when the chosen enemy falls earlier in the turn', () => {
    const { battle, actor } = setup('slimes', { levels: { hero: 30, mira: 40 } });
    const first = battle.enemies[0] as Battler;
    battle.setAction(actor('hero'), { kind: 'skill', skill: 'attack', target: first });
    battle.setAction(actor('mira'), { kind: 'skill', skill: 'attack', target: first });
    const events = battle.runTurn();
    const hits = events.flatMap((e) =>
      e.type === 'hit' && e.user !== battle.enemies[1] ? [e] : [],
    );
    const partyHits = hits.filter((e) => battle.actors.includes(e.user as Actor));
    // Whoever acted first knocked out Slime A; the second attack went to Slime B.
    expect(partyHits.map((e) => e.result.target)).toEqual([first, battle.enemies[1]]);
    expect(first.isKnockedOut).toBe(true);
  });

  it('skips actors who cannot act, and does not ask for their commands', () => {
    const { battle, actor } = setup('slimes', { levels: { hero: 10 } });
    actor('mira').addState('sleep', () => 0);
    expect(battle.actorsToCommand().map((a) => a.id)).toEqual(['hero']);
    battle.setAction(actor('hero'), { kind: 'skill', skill: 'guard' });
    const events = battle.runTurn();
    expect(events).toContainEqual({ type: 'cannotAct', user: actor('mira'), state: 'sleep' });
  });

  it('fails an item use gracefully when the last one was used earlier in the turn', () => {
    const { battle, party, actor } = setup('slimes', { levels: { hero: 10, mira: 10 } });
    party.gain('item', 'potion', 1);
    actor('hero').setHp(10);
    battle.setAction(actor('hero'), { kind: 'item', item: 'potion', target: actor('hero') });
    battle.setAction(actor('mira'), { kind: 'item', item: 'potion', target: actor('hero') });
    const events = battle.runTurn();
    expect(events.filter((e) => e.type === 'action' && e.name === 'Potion')).toHaveLength(1);
    expect(events.find((e) => e.type === 'actionFailed')).toMatchObject({
      name: 'Potion',
      reason: 'none left',
    });
    expect(party.count('item', 'potion')).toBe(0);
  });

  it('lets poison knock out in battle', () => {
    const { battle, actor } = setup('slimes', { members: ['hero'] });
    const hero = actor('hero');
    hero.addState('poison');
    hero.setHp(1);
    battle.setAction(hero, { kind: 'skill', skill: 'guard' });
    const events = battle.runTurn();
    expect(hero.isKnockedOut).toBe(true);
    expect(types(events)).toContain('defeat');
    expect(battle.phase).toBe('lost');
  });

  it('is lost when the whole party is knocked out, with no rewards', () => {
    const { battle, party, actor } = setup('bridge-wolf', { members: ['hero'], random: seeded(3) });
    actor('hero').setHp(1);
    battle.setAction(actor('hero'), { kind: 'skill', skill: 'guard' });
    let events = battle.runTurn();
    for (let i = 0; i < 20 && battle.phase === 'input'; i++) {
      battle.setAction(actor('hero'), { kind: 'skill', skill: 'guard' });
      events = battle.runTurn();
    }
    expect(battle.phase).toBe('lost');
    expect(events.at(-1)).toEqual({ type: 'defeat' });
    expect(party.gold).toBe(0);
  });

  it('clears battle-only states when the battle ends', () => {
    const { battle, actor, attackAll } = setup('slimes', { levels: { hero: 40, mira: 40 } });
    actor('mira').addState('sleep', () => 0.99);
    actor('hero').addState('poison');
    while (battle.phase === 'input') attackAll();
    expect(actor('mira').hasState('sleep')).toBe(false);
    expect(actor('hero').hasState('poison')).toBe(true);
  });
});

describe('Battle escape', () => {
  it('escapes on a good roll', () => {
    const { battle } = setup('slimes', { random: () => 0 });
    expect(battle.tryEscape()).toEqual([{ type: 'escape', success: true }]);
    expect(battle.phase).toBe('escaped');
  });

  it('on a failed roll the enemies get a free turn', () => {
    const { battle } = setup('slimes', { random: () => 0.99 });
    const events = battle.tryEscape();
    expect(events[0]).toEqual({ type: 'escape', success: false });
    const users = events.flatMap((e) => (e.type === 'action' ? [e.user] : []));
    expect(users.length).toBeGreaterThan(0);
    expect(users.every((u) => battle.enemies.includes(u as never))).toBe(true);
  });

  it('is refused when the battle cannot be escaped', () => {
    const { battle } = setup('slimes', { canEscape: false });
    expect(() => battle.tryEscape()).toThrow(/no escaping/);
  });
});
