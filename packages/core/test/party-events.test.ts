import type { Command, Condition, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  ActionState,
  GameState,
  Interpreter,
  Party,
  World,
  evaluateCondition,
} from '../src/index.js';
import { demoDb } from './demo-db.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const db = demoDb();

function setup() {
  const state = new GameState({ switches: [], variables: [{ id: 'reward', name: 'Reward' }] });
  const party = Party.start(db, { party: ['hero'], gold: 50 });
  const run = (commands: Command[]) => {
    const interpreter = new Interpreter(commands, { state, party });
    interpreter.update(1 / 60);
    return interpreter;
  };
  return { state, party, run };
}

describe('party commands', () => {
  it('changes gold by a literal or a variable, clamped at 0', () => {
    const { state, party, run } = setup();
    run([{ type: 'changeGold', amount: 25 }]);
    expect(party.gold).toBe(75);
    state.setVariable('reward', -100);
    run([{ type: 'changeGold', amount: { variable: 'reward' } }]);
    expect(party.gold).toBe(0);
  });

  it('gives and takes items and equipment', () => {
    const { party, run } = setup();
    run([
      { type: 'changeItems', kind: 'item', id: 'potion', amount: 3 },
      { type: 'changeItems', kind: 'item', id: 'potion', amount: -1 },
      { type: 'changeItems', kind: 'equipment', id: 'straw-hat', amount: 1 },
    ]);
    expect(party.count('item', 'potion')).toBe(2);
    expect(party.count('equipment', 'straw-hat')).toBe(1);
  });

  it('adds and removes party members', () => {
    const { party, run } = setup();
    run([{ type: 'changeParty', action: 'add', actor: 'mira' }]);
    expect(party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
    run([{ type: 'changeParty', action: 'remove', actor: 'hero' }]);
    expect(party.members.map((m) => m.id)).toEqual(['mira']);
  });

  it('gives exp to one member or everyone, ignoring absent actors', () => {
    const { party, run } = setup();
    party.addMember('mira');
    run([{ type: 'gainExp', actor: 'hero', amount: 100 }]);
    expect(party.member('hero')?.exp).toBe(100);
    const miraExp = party.member('mira')?.exp ?? 0;
    run([{ type: 'gainExp', amount: 10 }]);
    expect(party.member('hero')?.exp).toBe(110);
    expect(party.member('mira')?.exp).toBe(miraExp + 10);
    run([{ type: 'gainExp', actor: 'ghost', amount: 10 }]); // not in party: no effect, no error
  });

  it('fully recovers like an inn', () => {
    const { party, run } = setup();
    const hero = party.member('hero');
    if (!hero) throw new Error('fixture');
    hero.setHp(1);
    hero.addState('poison');
    run([{ type: 'recoverAll' }]);
    expect(hero.hp).toBe(hero.maxHp);
    expect(hero.states).toEqual([]);
  });

  it('explains when a party command runs without a party', () => {
    const interpreter = new Interpreter([{ type: 'changeGold', amount: 1 }], new GameState());
    expect(() => interpreter.update(1 / 60)).toThrow(/changeGold command needs the party/);
  });
});

describe('party conditions', () => {
  const check = (condition: Condition, party: Party) =>
    evaluateCondition(condition, { state: new GameState(), party });

  it('compares gold', () => {
    const { party } = setup();
    expect(check({ type: 'gold', op: '>=', value: 50 }, party)).toBe(true);
    expect(check({ type: 'gold', op: '>', value: 50 }, party)).toBe(false);
  });

  it('checks item counts, optionally counting worn equipment', () => {
    const { party } = setup();
    party.gain('item', 'potion', 2);
    expect(check({ type: 'hasItem', kind: 'item', id: 'potion' }, party)).toBe(true);
    expect(check({ type: 'hasItem', kind: 'item', id: 'potion', count: 3 }, party)).toBe(false);
    const sword = { type: 'hasItem', kind: 'equipment', id: 'bronze-sword' } as const;
    expect(check(sword, party)).toBe(false);
    expect(check({ ...sword, includeEquipped: true }, party)).toBe(true);
  });

  it('checks party membership', () => {
    const { party } = setup();
    expect(check({ type: 'inParty', actor: 'hero' }, party)).toBe(true);
    expect(check({ type: 'inParty', actor: 'mira' }, party)).toBe(false);
  });

  it('explains when evaluated without a party', () => {
    expect(() => evaluateCondition({ type: 'gold', op: '>', value: 0 }, new GameState())).toThrow(
      /needs the party/,
    );
  });
});

describe('event pages react to the party', () => {
  it('switches an NPC page when gold changes, without any switch involved', () => {
    const merchant: MapEvent = {
      id: 'merchant',
      name: 'Merchant',
      x: 1,
      y: 0,
      pages: [
        { conditions: [], trigger: 'action', layer: 'same', commands: [] },
        {
          conditions: [{ type: 'gold', op: '>=', value: 100 }],
          trigger: 'action',
          layer: 'same',
          commands: [],
        },
      ],
    };
    const map = makeMap(['...']);
    map.events = [merchant];
    const world = new World({
      manifest: {
        ...makeManifest(),
        start: { ...makeManifest().start, party: ['hero'], gold: 50 },
      },
      map,
      tileset,
      database: db,
    });
    const input = new ActionState();
    world.step(1 / 60, input);
    expect(world.events[0]?.pageIndex).toBe(0);
    world.run([{ type: 'changeGold', amount: 50 }]);
    world.step(1 / 60, input);
    expect(world.events[0]?.pageIndex).toBe(1);
  });
});
