// M16 step 5: how battles move: enemies entering, the acting enemy's hop,
// the pause and sound as each turn starts, and damage numbers.
import { ActionState, Battle, GameState, Party } from '@freequest/core';
import { describe, expect, it } from 'vitest';
import { BattleController } from '../src/battle-controller.js';
import {
  ACT_HOP_HEIGHT,
  ACT_HOP_SECONDS,
  ENTRANCE_DELAY,
  ENTRANCE_RISE,
  ENTRANCE_SECONDS,
  POPUP_SECONDS,
  POPUP_START_SCALE,
  TURN_PAUSE_SECONDS,
  actHop,
  entrance,
  popupMotion,
} from '../src/battle-feel.js';
import { demoDb } from './demo.js';

const db = demoDb();

describe('battle timings', () => {
  it('enemies fade and rise into place as the battle opens', () => {
    expect(entrance(0)).toEqual({ alpha: 0, offsetY: ENTRANCE_RISE });
    // Not until the screen has faded in from black.
    expect(entrance(ENTRANCE_DELAY)).toEqual({ alpha: 0, offsetY: ENTRANCE_RISE });
    const half = entrance(ENTRANCE_DELAY + ENTRANCE_SECONDS / 2);
    expect(half.alpha).toBeGreaterThan(0.5); // eased: most of the way already
    expect(half.offsetY).toBeLessThan(ENTRANCE_RISE / 2);
    expect(entrance(ENTRANCE_DELAY + ENTRANCE_SECONDS)).toEqual({ alpha: 1, offsetY: 0 });
    expect(entrance(99)).toEqual({ alpha: 1, offsetY: 0 });
  });

  it('the acting enemy hops once', () => {
    expect(actHop(0)).toBe(0);
    expect(actHop(ACT_HOP_SECONDS / 2)).toBe(ACT_HOP_HEIGHT);
    expect(actHop(ACT_HOP_SECONDS)).toBe(0);
    expect(actHop(-1)).toBe(0);
  });

  it('damage numbers pop in large, settle, rise, hold and fade', () => {
    expect(popupMotion(0)).toEqual({ rise: 0, alpha: 1, scale: POPUP_START_SCALE });
    const settled = popupMotion(POPUP_SECONDS * 0.5);
    expect(settled.scale).toBe(1);
    expect(settled.alpha).toBe(1);
    expect(settled.rise).toBe(14);
    expect(popupMotion(POPUP_SECONDS).alpha).toBe(0);
  });
});

describe('the battle controller’s timings', () => {
  function setup() {
    const party = Party.start(db, { party: ['hero'], gold: 0 });
    for (const m of party.members) {
      m.changeLevel(20);
      m.recoverAll();
    }
    const battle = new Battle({
      db,
      party,
      troop: 'slimes',
      state: new GameState(),
      canEscape: true,
      random: () => 0.5,
    });
    const ui = new BattleController(battle, db, { lineSeconds: 0.5 });
    const input = new ActionState();
    const tick = (n = 1) => {
      for (let i = 0; i < n; i++) {
        ui.update(1 / 60, input);
        input.endStep();
      }
    };
    const tap = (action: 'confirm' | 'down') => {
      input.press(action);
      tick();
      input.release(action);
    };
    return { ui, tick, tap, battle };
  }

  it('counts the seconds since the battle opened', () => {
    const { ui, tick } = setup();
    expect(ui.state.opened).toBe(0);
    tick(30);
    expect(ui.state.opened).toBeCloseTo(0.5);
  });

  it('pauses as each turn starts, with the turn sound once, then shows who acts', () => {
    const { ui, tick, tap, battle } = setup();
    for (let i = 0; i < 60 && ui.state.stage === 'playback'; i++) tick();
    tap('confirm'); // Fight
    tap('confirm'); // Attack
    tap('confirm'); // the first slime
    expect(ui.state).toMatchObject({ stage: 'playback', line: null, acting: null });
    tick(); // the pause's first frame plays the sound
    expect(ui.drainSounds()).toEqual(['assets/audio/sfx-turnStart.wav']);
    tick(Math.ceil(TURN_PAUSE_SECONDS * 60) - 3);
    expect(ui.state.line).toBeNull();
    expect(ui.drainSounds()).toEqual([]);
    // After the pause: someone's action line, with who acts and for how long.
    for (let i = 0; i < 10 && ui.state.line === null; i++) tick();
    const acting = ui.state.acting;
    expect(
      acting?.battler === battle.actors[0] || battle.enemies.includes(acting?.battler as never),
    ).toBe(true);
    expect(acting?.elapsed).toBeGreaterThanOrEqual(0);
  });
});
