import { type Action, ActionState, Battle, GameState, Party } from '@freequest/core';
import { describe, expect, it } from 'vitest';
import { BattleController, type BattleStage } from '../src/battle-controller.js';
import { describeEvent } from '../src/battle-text.js';
import { demoDb } from './demo.js';

const db = demoDb();

interface SetupOptions {
  members?: string[];
  canEscape?: boolean;
  random?: () => number;
}

function setup(troop = 'slimes', options: SetupOptions = {}) {
  const { members = ['hero', 'mira'], canEscape = true, random = () => 0.5 } = options;
  const party = Party.start(db, { party: members, gold: 0 });
  for (const m of party.members) {
    m.changeLevel(20);
    m.recoverAll();
  }
  const battle = new Battle({ db, party, troop, state: new GameState(), canEscape, random });
  const ui = new BattleController(battle, db, { lineSeconds: 0.5 });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      ui.update(1 / 60, input);
      input.endStep();
    }
  };
  const tap = (action: Action) => {
    input.press(action);
    tick();
    input.release(action);
  };
  /** Read fresh each time (avoids TypeScript narrowing across calls that change it). */
  const stage = (): BattleStage => ui.state.stage;
  /** Advance through log lines until a menu (or the end) shows. */
  const skipLog = () => {
    for (let i = 0; i < 200 && ui.state.stage === 'playback'; i++) tap('confirm');
  };
  return { party, battle, ui, tick, tap, skipLog, stage };
}

describe('BattleController', () => {
  it('announces the enemies, then opens the party menu', () => {
    const { ui, tick } = setup();
    expect(ui.state).toMatchObject({ stage: 'playback', line: 'Slime A and Slime B appear!' });
    tick(31); // 0.5 s per line
    expect(ui.state.stage).toBe('party');
    expect(ui.state.menu?.options.map((o) => o.label)).toEqual(['Fight', 'Escape']);
  });

  it('commands each actor, choosing targets, then plays the turn', () => {
    const { ui, battle, tap, skipLog } = setup();
    skipLog();
    tap('confirm'); // Fight
    expect(ui.state).toMatchObject({ stage: 'actor', menu: { title: 'Hero' } });
    expect(ui.state.menu?.options.map((o) => [o.label, o.enabled])).toEqual([
      ['Attack', true],
      ['Skill', true], // a level 20 warrior knows Power Strike
      ['Guard', true],
      ['Item', false], // nothing carried
    ]);
    tap('confirm'); // Attack → target
    expect(ui.state.stage).toBe('target');
    expect(ui.state.target).toBe(battle.enemies[0]);
    tap('right');
    expect(ui.state.target).toBe(battle.enemies[1]);
    tap('confirm');
    expect(ui.state).toMatchObject({ stage: 'actor', menu: { title: 'Mira' } });
    tap('down');
    tap('down'); // Guard
    tap('confirm');
    expect(ui.state.stage).toBe('playback');
    expect(ui.state.line).toBe('Mira uses Guard!'); // guard goes first
  });

  it('opens the skill list with costs and greys out what cannot be used', () => {
    const { ui, battle, tap, skipLog } = setup();
    skipLog();
    tap('confirm'); // Fight
    tap('confirm'); // Hero: Attack
    tap('confirm'); // target
    tap('down'); // Mira: Skill
    tap('confirm');
    expect(ui.state.stage).toBe('skill');
    const mira = battle.actors[1];
    expect(ui.state.menu?.options.map((o) => [o.label, o.detail])).toEqual([
      ['Fire', '5 MP'],
      ['Heal', '4 MP'],
      ['Blizzard', '9 MP'],
    ]);
    mira?.setMp(4);
    expect(ui.state.menu?.options.map((o) => o.enabled)).toEqual([false, true, false]);
    tap('confirm'); // Fire is disabled: nothing happens
    expect(ui.state.stage).toBe('skill');
    tap('cancel');
    expect(ui.state.stage).toBe('actor');
  });

  it('cancel walks back to the previous actor and undoes their choice', () => {
    const { ui, battle, tap, skipLog } = setup();
    skipLog();
    tap('confirm'); // Fight
    tap('down');
    tap('down');
    tap('confirm'); // Hero: Guard
    const hero = battle.actors[0];
    if (!hero) throw new Error('fixture');
    expect(battle.actionOf(hero)).toBeDefined();
    tap('cancel'); // back to Hero
    expect(ui.state.menu?.title).toBe('Hero');
    expect(battle.actionOf(hero)).toBeUndefined();
    tap('cancel');
    expect(ui.state.stage).toBe('party');
  });

  it('offers items when carried and asks for an ally target', () => {
    const { ui, party, battle, tap, skipLog } = setup();
    party.gain('item', 'potion', 2);
    party.gain('item', 'meadow-map', 1); // never usable: not listed
    skipLog();
    tap('confirm'); // Fight
    tap('up'); // wrap to Item
    tap('confirm');
    expect(ui.state.stage).toBe('item');
    expect(ui.state.menu?.options).toEqual([
      { label: 'Potion', detail: '×2', enabled: true, icon: 0 },
    ]);
    tap('confirm');
    expect(ui.state.stage).toBe('target');
    expect(ui.state.target).toBe(battle.actors[0]);
    tap('cancel');
    expect(ui.state.stage).toBe('item');
  });

  it('holds on the results until confirmed', () => {
    const { ui, tick, tap, skipLog, stage } = setup('slimes', { random: () => 0.1 });
    for (let i = 0; i < 400 && ui.state.line !== 'Victory!'; i++) tap('confirm');
    expect(ui.state.line).toBe('Victory!');
    tick(600); // ten seconds: no timeout on results
    expect(ui.state.line).toBe('Victory!');
    expect(stage()).toBe('playback');
    skipLog();
    expect(ui.outcome).toBe('win');
  });

  it('wins and reports the outcome', () => {
    const { ui, tap, skipLog } = setup('slimes', { random: () => 0.1 });
    // Confirm through everything: Fight, Attack, first target, log lines.
    for (let i = 0; i < 400 && ui.outcome === null; i++) tap('confirm');
    skipLog();
    expect(ui.outcome).toBe('win');
    expect(ui.state.stage).toBe('finished');
  });

  it('escapes from the party menu', () => {
    const { ui, tap, skipLog } = setup('slimes', { random: () => 0 });
    skipLog();
    tap('down'); // Escape
    tap('confirm');
    expect(ui.state.line).toBe('The party escaped!');
    skipLog();
    expect(ui.outcome).toBe('escape');
  });

  it('greys out Escape when the battle cannot be escaped', () => {
    const { ui, tap, skipLog } = setup('slimes', { canEscape: false });
    skipLog();
    expect(ui.state.menu?.options[1]).toEqual({ label: 'Escape', enabled: false });
    tap('down');
    tap('confirm');
    expect(ui.state.stage).toBe('party');
  });
});

describe('describeEvent', () => {
  it('narrates attacks, damage, knockouts and rewards', () => {
    const { battle } = setup();
    const [hero, mira] = battle.actors;
    const [slime] = battle.enemies;
    if (!hero || !mira || !slime) throw new Error('fixture');
    expect(describeEvent({ type: 'action', user: hero, name: 'Attack' }, db)).toEqual([
      'Hero attacks!',
    ]);
    expect(describeEvent({ type: 'action', user: mira, name: 'Fire' }, db)).toEqual([
      'Mira uses Fire!',
    ]);
    const hit = {
      target: slime,
      missed: false,
      hpDamage: 60,
      mpDamage: 0,
      critical: true,
      addedStates: ['knockout'],
      removedStates: [],
      learnedSkills: [],
    };
    expect(describeEvent({ type: 'hit', user: hero, result: hit }, db)).toEqual([
      'Critical hit! Slime A takes 60 damage.',
      'Slime A is defeated!',
    ]);
    expect(
      describeEvent(
        { type: 'hit', user: slime, result: { ...hit, target: hero, critical: false } },
        db,
      ),
    ).toEqual(['Hero takes 60 damage.', 'Hero falls!']);
    expect(
      describeEvent({ type: 'hit', user: hero, result: { ...hit, missed: true } }, db),
    ).toEqual(['Slime A evades the attack!']);
    expect(
      describeEvent(
        {
          type: 'victory',
          exp: 12,
          gold: 16,
          drops: [{ kind: 'item', id: 'potion' }],
          levelUps: [{ actor: hero, level: 3, learnedSkills: ['power-strike'] }],
        },
        db,
      ),
    ).toEqual([
      'Victory!',
      'Gained 12 EXP.',
      'Found 16 G.',
      'Got Potion!',
      'Hero reached level 3!',
      'Hero learned Power Strike!',
    ]);
  });
});
