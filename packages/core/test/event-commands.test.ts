// M14 step 4: variables from random numbers and game values, branch-only
// tests (keys, facing, actors), placing events, scrolling the map, the game
// flow requests, access, battle music, background sounds and HP/MP/states.
import { type Command, type IfCondition, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { ActionState, GameState, Interpreter, MapScroll, Party, World } from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const tileset = parseProjectFile('tileset', rawTileset);

function world(random?: () => number) {
  return new World({
    manifest,
    map,
    tileset,
    database: demoDb(),
    ...(random ? { random } : {}),
  });
}

/** Run commands in the world (as an event would), stepping until they finish. */
function run(w: World, commands: readonly Command[], input = new ActionState(), self?: string) {
  const source = self ? (w.events.find((e) => e.id === self) ?? null) : null;
  const interpreter = w.run(commands, source);
  for (let i = 0; i < 2000 && w.interpreter === interpreter; i++) w.step(1 / 60, input);
  return interpreter;
}

const visits = (w: World) => w.state.getVariable('bridge_visits');
const setTo = (value: Extract<Command, { type: 'setVariable' }>['value']): Command => ({
  type: 'setVariable',
  variable: 'bridge_visits',
  op: 'set',
  value,
});

/** 1 if the conditions hold when run in `w`, else 0 (in bridge_visits). */
function holds(w: World, conditions: IfCondition[], input?: ActionState, self?: string): boolean {
  run(w, [setTo(0), { type: 'if', conditions, then: [setTo(1)] }], input, self);
  return visits(w) === 1;
}

describe('variables from random numbers and game values', () => {
  it('picks random whole numbers from min to max, both included', () => {
    const w = world(() => 0.999);
    run(w, [setTo({ random: { min: 3, max: 5 } })]);
    expect(visits(w)).toBe(5);
    const low = world(() => 0);
    run(low, [setTo({ random: { min: 3, max: 5 } })]);
    expect(visits(low)).toBe(3);
  });

  it('reads gold, steps, party size, item counts and actor stats', () => {
    const w = world();
    w.party.gain('item', 'potion', 3);
    run(w, [setTo({ game: { type: 'gold' } })]);
    expect(visits(w)).toBe(50);
    run(w, [setTo({ game: { type: 'partySize' } })]);
    expect(visits(w)).toBe(1);
    run(w, [setTo({ game: { type: 'itemCount', kind: 'item', id: 'potion' } })]);
    expect(visits(w)).toBe(3);
    run(w, [setTo({ game: { type: 'actorStat', actor: 'hero', stat: 'level' } })]);
    expect(visits(w)).toBe(w.party.members[0]?.level);
    run(w, [setTo({ game: { type: 'actorStat', actor: 'hero', stat: 'attack' } })]);
    expect(visits(w)).toBe(w.party.members[0]?.stat('attack'));
    // Not in the party: 0.
    run(w, [setTo({ game: { type: 'actorStat', actor: 'mira', stat: 'hp' } })]);
    expect(visits(w)).toBe(0);
    run(w, [setTo({ game: { type: 'steps' } })]);
    expect(visits(w)).toBe(0);
  });

  it('reads positions of the player and events, and the time played', () => {
    const w = world();
    run(w, [setTo({ game: { type: 'position', target: 'player', axis: 'x' } })]);
    expect(visits(w)).toBe(7);
    run(w, [setTo({ game: { type: 'position', target: 'elder', axis: 'y' } })]);
    expect(visits(w)).toBe(8);
    run(w, [setTo({ game: { type: 'position', target: 'this', axis: 'x' } })], undefined, 'sign');
    expect(visits(w)).toBe(6);
    w.playSeconds = 125.7;
    run(w, [setTo({ game: { type: 'playTime' } })]);
    expect(visits(w)).toBeGreaterThanOrEqual(125);
  });

  it('applies the operation to the value (add a random number)', () => {
    const w = world(() => 0);
    run(w, [
      setTo(10),
      {
        type: 'setVariable',
        variable: 'bridge_visits',
        op: 'add',
        value: { random: { min: 2, max: 2 } },
      },
    ]);
    expect(visits(w)).toBe(12);
  });
});

describe('branch tests', () => {
  it('tests a held key', () => {
    const w = world();
    const input = new ActionState();
    expect(holds(w, [{ type: 'held', action: 'confirm' }], input)).toBe(false);
    input.press('confirm');
    expect(holds(w, [{ type: 'held', action: 'confirm' }], input)).toBe(true);
  });

  it('tests which way the player or an event faces', () => {
    const w = world();
    expect(holds(w, [{ type: 'facing', target: 'player', direction: 'down' }])).toBe(true);
    expect(holds(w, [{ type: 'facing', target: 'player', direction: 'up' }])).toBe(false);
    expect(holds(w, [{ type: 'facing', target: 'elder', direction: 'down' }])).toBe(true);
    expect(holds(w, [{ type: 'facing', target: 'nobody', direction: 'down' }])).toBe(false);
  });

  it('tests party members’ states, level, HP and names', () => {
    const w = world();
    const hero = w.party.members[0];
    if (!hero) throw new Error('no hero');
    expect(holds(w, [{ type: 'actorState', actor: 'hero', state: 'poison', value: false }])).toBe(
      true,
    );
    hero.addState('poison');
    expect(holds(w, [{ type: 'actorState', actor: 'hero', state: 'poison', value: true }])).toBe(
      true,
    );
    expect(
      holds(w, [{ type: 'actorStat', actor: 'hero', stat: 'hpPercent', op: '==', value: 100 }]),
    ).toBe(true);
    hero.setHp(Math.floor(hero.maxHp / 4));
    expect(
      holds(w, [{ type: 'actorStat', actor: 'hero', stat: 'hpPercent', op: '<=', value: 25 }]),
    ).toBe(true);
    expect(
      holds(w, [{ type: 'actorStat', actor: 'hero', stat: 'level', op: '>=', value: 1 }]),
    ).toBe(true);
    // Mira isn't in the party: no states, level 0.
    expect(
      holds(w, [{ type: 'actorStat', actor: 'mira', stat: 'level', op: '>=', value: 1 }]),
    ).toBe(false);
    run(w, [{ type: 'changeActor', actor: 'hero', name: 'Ash' }]);
    expect(holds(w, [{ type: 'actorName', actor: 'hero', name: 'Ash' }])).toBe(true);
  });
});

describe('placeEvent', () => {
  it('puts an event on a tile, facing a way, from numbers or variables', () => {
    const w = world();
    run(w, [{ type: 'placeEvent', event: 'elder', x: 3, y: 2, direction: 'left' }]);
    const elder = w.events.find((e) => e.id === 'elder');
    expect(elder).toMatchObject({ x: 3, y: 2, direction: 'left' });
    run(w, [
      setTo(5),
      { type: 'placeEvent', event: 'elder', x: { variable: 'bridge_visits' }, y: 1 },
    ]);
    expect(elder).toMatchObject({ x: 5, y: 1 });
  });

  it('places the event running it, and ignores a spot off the map', () => {
    const w = world();
    run(w, [{ type: 'placeEvent', x: 1, y: 1 }], undefined, 'sign');
    expect(w.events.find((e) => e.id === 'sign')).toMatchObject({ x: 1, y: 1 });
    run(w, [{ type: 'placeEvent', x: 99, y: 1 }], undefined, 'sign');
    expect(w.events.find((e) => e.id === 'sign')).toMatchObject({ x: 1, y: 1 });
  });
});

describe('scrollMap', () => {
  it('moves the view at its speed, waits for it, and comes back', () => {
    const w = world();
    const interpreter = w.run([
      { type: 'scrollMap', direction: 'right', tiles: 4, speed: 4, wait: true },
      { type: 'scrollMap', direction: 'up', tiles: 2, speed: 4, wait: false },
    ]);
    const input = new ActionState();
    for (let i = 0; i < 30; i++) w.step(1 / 60, input);
    // About half way (it starts during the first step).
    expect(w.scroll.x).toBeGreaterThan(1.8);
    expect(w.scroll.x).toBeLessThan(2.1);
    expect(w.interpreter).toBe(interpreter);
    for (let i = 0; i < 32; i++) w.step(1 / 60, input);
    expect(w.scroll.x).toBe(4);
    expect(w.interpreter).toBeNull();
    for (let i = 0; i < 60; i++) w.step(1 / 60, input);
    expect(w.scroll.y).toBe(-2);
    run(w, [{ type: 'scrollMap', direction: 'back', tiles: 0, speed: 32, wait: true }]);
    expect([w.scroll.x, w.scroll.y]).toEqual([0, 0]);
  });

  it('a replaced scroll counts as finished', () => {
    const scroll = new MapScroll();
    const first = scroll.by(10, 0, 1);
    const second = scroll.back(1);
    expect(first()).toBe(true);
    expect(second()).toBe(true);
    scroll.update(1);
    expect(scroll.x).toBe(0);
  });

  it('is reset by a map change', () => {
    const w = world();
    run(w, [{ type: 'scrollMap', direction: 'down', tiles: 1, speed: 32, wait: true }]);
    expect(w.scroll.y).toBe(1);
    w.changeMap(map, tileset, 7, 7);
    expect(w.scroll.y).toBe(0);
  });
});

describe('game flow', () => {
  it('asks the runtime for game over, the title and the save screen', () => {
    const state = new GameState(manifest);
    for (const [type, request] of [
      ['gameOver', 'gameOver'],
      ['returnToTitle', 'title'],
      ['openSave', 'save'],
    ] as const) {
      const interpreter = new Interpreter([{ type }], state);
      interpreter.update(1 / 60);
      expect(interpreter.pending).toEqual({ type: request });
    }
    const gameOver = new Interpreter([{ type: 'gameOver' }], state);
    gameOver.update(1 / 60);
    expect(() => gameOver.continue()).toThrow();
    const save = new Interpreter([{ type: 'openSave' }, { type: 'comment', text: '' }], state);
    save.update(1 / 60);
    save.continue();
    save.update(1 / 60);
    expect(save.isDone).toBe(true);
  });

  it('saves from an event as if it had finished', () => {
    const w = world();
    const interpreter = w.run([{ type: 'openSave' }]);
    w.step(1 / 60, new ActionState());
    expect(interpreter.pending).toEqual({ type: 'save' });
    expect(() => w.toSave({ game: manifest.id, playSeconds: 1 })).toThrow();
    const save = w.toSave({ game: manifest.id, playSeconds: 1, fromEvent: true });
    expect(save.map).toBe('map001');
  });

  it('turns the menu and saving off and on, kept in saves', () => {
    const w = world();
    run(w, [
      { type: 'setAccess', what: 'menu', allowed: false },
      { type: 'setAccess', what: 'saving', allowed: false },
      { type: 'setAccess', what: 'menu', allowed: true },
    ]);
    expect(w.access).toEqual({ menu: true, saving: false, formation: true });
    const save = w.toSave({ game: manifest.id, playSeconds: 10 });
    expect(save.access).toEqual({ saving: false });
    const loaded = World.fromSave(save, { manifest, map, tileset, database: demoDb() });
    expect(loaded.access).toEqual({ menu: true, saving: false, formation: true });
    expect(loaded.playSeconds).toBe(10);
  });
});

describe('music and sounds', () => {
  it('changes battle and victory music, kept in saves; null goes back', () => {
    const w = world();
    run(w, [
      { type: 'changeBattleMusic', which: 'battle', path: 'assets/audio/music/boss.wav' },
      { type: 'changeBattleMusic', which: 'victory', path: 'assets/audio/music/fanfare.wav' },
      { type: 'changeBattleMusic', which: 'victory', path: null },
    ]);
    expect(w.battleMusic).toEqual({ battle: 'assets/audio/music/boss.wav' });
    const save = w.toSave({ game: manifest.id, playSeconds: 0 });
    expect(save.battleMusic).toEqual({ battle: 'assets/audio/music/boss.wav' });
    expect(
      World.fromSave(save, { manifest, map, tileset, database: demoDb() }).battleMusic,
    ).toEqual({ battle: 'assets/audio/music/boss.wav' });
  });

  it('plays a background sound until the map changes, then the map’s own', () => {
    const w = world();
    expect(w.backgroundSound).toBeNull();
    run(w, [{ type: 'playBackgroundSound', path: 'assets/audio/sounds/rain.wav' }]);
    expect(w.backgroundSound).toBe('assets/audio/sounds/rain.wav');
    w.changeMap({ ...map, backgroundSound: 'assets/audio/sounds/wind.wav' }, tileset, 7, 7);
    expect(w.backgroundSound).toBe('assets/audio/sounds/wind.wav');
    run(w, [{ type: 'playBackgroundSound', path: null }]);
    expect(w.backgroundSound).toBeNull();
  });
});

describe('HP, MP and states', () => {
  it('gives and takes HP and MP from one member or everyone', () => {
    const party = Party.start(demoDb(), { party: ['hero', 'mira'], gold: 0 });
    const state = new GameState(manifest);
    const [hero, mira] = party.members;
    if (!hero || !mira) throw new Error('no party');
    new Interpreter(
      [
        { type: 'changeHp', amount: -5, canKnockOut: false },
        { type: 'changeMp', actor: 'mira', amount: -3 },
      ],
      { state, party },
    ).update(1 / 60);
    expect(hero.hp).toBe(hero.maxHp - 5);
    expect(mira.hp).toBe(mira.maxHp - 5);
    expect(mira.mp).toBe(mira.maxMp - 3);
    expect(hero.mp).toBe(hero.maxMp);
  });

  it('stops at 1 HP unless it may knock out', () => {
    const party = Party.start(demoDb(), { party: ['hero'], gold: 0 });
    const state = new GameState(manifest);
    const hero = party.members[0];
    if (!hero) throw new Error('no hero');
    new Interpreter([{ type: 'changeHp', amount: -9999, canKnockOut: false }], {
      state,
      party,
    }).update(1 / 60);
    expect(hero.hp).toBe(1);
    new Interpreter([{ type: 'changeHp', amount: -9999, canKnockOut: true }], {
      state,
      party,
    }).update(1 / 60);
    expect(hero.isKnockedOut).toBe(true);
    // A knocked-out member isn't healed by it (remove the state to revive).
    new Interpreter([{ type: 'changeHp', amount: 50, canKnockOut: false }], {
      state,
      party,
    }).update(1 / 60);
    expect(hero.hp).toBe(0);
    new Interpreter([{ type: 'changeState', action: 'remove', state: 'knockout' }], {
      state,
      party,
    }).update(1 / 60);
    expect(hero.hp).toBe(1);
  });

  it('adds and removes states', () => {
    const party = Party.start(demoDb(), { party: ['hero'], gold: 0 });
    const state = new GameState(manifest);
    new Interpreter([{ type: 'changeState', actor: 'hero', action: 'add', state: 'poison' }], {
      state,
      party,
    }).update(1 / 60);
    expect(party.members[0]?.hasState('poison')).toBe(true);
    new Interpreter([{ type: 'changeState', action: 'remove', state: 'poison' }], {
      state,
      party,
    }).update(1 / 60);
    expect(party.members[0]?.hasState('poison')).toBe(false);
  });
});
