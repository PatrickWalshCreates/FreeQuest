import type { Command } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, GameState, Interpreter, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;

function newState(): GameState {
  return new GameState({
    switches: [
      { id: 'a', name: 'A' },
      { id: 'b', name: 'B' },
    ],
    variables: [{ id: 'n', name: 'N' }],
  });
}

const say = (text: string): Command => ({ type: 'message', text });

describe('Interpreter', () => {
  it('runs non-blocking commands to completion in one update', () => {
    const state = newState();
    const it = new Interpreter(
      [
        { type: 'comment', text: 'setup' },
        { type: 'setSwitch', switch: 'a', value: true },
        { type: 'setVariable', variable: 'n', op: 'add', value: 3 },
      ],
      state,
    );
    expect(it.isDone).toBe(false);
    it.update(DT);
    expect(it.isDone).toBe(true);
    expect([state.getSwitch('a'), state.getVariable('n')]).toEqual([true, 3]);
  });

  it('an empty command list is done immediately', () => {
    expect(new Interpreter([], newState()).isDone).toBe(true);
  });

  it('pauses on a message until continued', () => {
    const state = newState();
    const it = new Interpreter(
      [
        { type: 'message', speaker: 'Elder', text: 'Hello' },
        { type: 'setSwitch', switch: 'a', value: true },
      ],
      state,
    );
    it.update(DT);
    expect(it.pending).toEqual({ type: 'message', speaker: 'Elder', text: 'Hello' });
    it.update(DT); // still waiting: updates do nothing
    expect(state.getSwitch('a')).toBe(false);
    it.continue();
    expect(it.pending).toBeNull();
    it.update(DT);
    expect(state.getSwitch('a')).toBe(true);
    expect(it.isDone).toBe(true);
  });

  it('reports a null speaker when none is given', () => {
    const it = new Interpreter([say('hi')], newState());
    it.update(DT);
    expect(it.pending).toEqual({ type: 'message', speaker: null, text: 'hi' });
  });

  it('runs the chosen option, then continues after the choice', () => {
    const state = newState();
    const it = new Interpreter(
      [
        {
          type: 'choice',
          options: [
            { label: 'Yes', commands: [{ type: 'setSwitch', switch: 'a', value: true }] },
            { label: 'No', commands: [{ type: 'setSwitch', switch: 'b', value: true }] },
          ],
        },
        { type: 'setVariable', variable: 'n', op: 'set', value: 7 },
      ],
      state,
    );
    it.update(DT);
    expect(it.pending).toEqual({ type: 'choice', options: ['Yes', 'No'], cancel: null });
    it.choose(1);
    it.update(DT);
    expect([state.getSwitch('a'), state.getSwitch('b'), state.getVariable('n')]).toEqual([
      false,
      true,
      7,
    ]);
    expect(it.isDone).toBe(true);
  });

  it('cancels to the cancel option, or refuses when there is none', () => {
    const choice = (cancel?: number): Command => ({
      type: 'choice',
      options: [
        { label: 'Yes', commands: [{ type: 'setSwitch', switch: 'a', value: true }] },
        { label: 'No', commands: [{ type: 'setSwitch', switch: 'b', value: true }] },
      ],
      ...(cancel === undefined ? {} : { cancel }),
    });

    const state = newState();
    const cancellable = new Interpreter([choice(1)], state);
    cancellable.update(DT);
    expect(cancellable.cancel()).toBe(true);
    cancellable.update(DT);
    expect(state.getSwitch('b')).toBe(true);

    const stuck = new Interpreter([choice()], newState());
    stuck.update(DT);
    expect(stuck.cancel()).toBe(false);
    expect(stuck.pending?.type).toBe('choice');
  });

  it('rejects answers that do not match the pending request', () => {
    const it = new Interpreter([say('hi')], newState());
    expect(() => it.continue()).toThrow(/nothing is pending/);
    it.update(DT);
    expect(() => it.choose(0)).toThrow(/no choice is pending/);
    expect(() => it.cancel()).toThrow(/no choice is pending/);

    const c = new Interpreter(
      [{ type: 'choice', options: [{ label: 'Only', commands: [] }] }],
      newState(),
    );
    c.update(DT);
    expect(() => c.continue()).toThrow(/a choice is pending/);
    expect(() => c.choose(5)).toThrow(/no option 5/);
  });

  it('takes the then or else branch based on state at execution time', () => {
    const state = newState();
    const branch: Command = {
      type: 'if',
      conditions: [{ type: 'switch', switch: 'a', value: true }],
      then: [{ type: 'setVariable', variable: 'n', op: 'add', value: 10 }],
      else: [{ type: 'setVariable', variable: 'n', op: 'add', value: 1 }],
    };
    // The first `if` sees a=false; then a is set; the second `if` sees a=true.
    const it = new Interpreter(
      [branch, { type: 'setSwitch', switch: 'a', value: true }, branch],
      state,
    );
    it.update(DT);
    expect(state.getVariable('n')).toBe(11);
  });

  it('skips an if with no else when its conditions fail', () => {
    const state = newState();
    const it = new Interpreter(
      [
        {
          type: 'if',
          conditions: [{ type: 'switch', switch: 'a', value: true }],
          then: [{ type: 'setSwitch', switch: 'b', value: true }],
        },
        { type: 'setVariable', variable: 'n', op: 'set', value: 1 },
      ],
      state,
    );
    it.update(DT);
    expect([state.getSwitch('b'), state.getVariable('n')]).toEqual([false, 1]);
  });

  it('returns to the outer list after deeply nested blocks', () => {
    const state = newState();
    const it = new Interpreter(
      [
        {
          type: 'if',
          conditions: [{ type: 'variable', variable: 'n', op: '==', value: 0 }],
          then: [
            {
              type: 'choice',
              options: [
                {
                  label: 'Go',
                  commands: [
                    say('inner'),
                    { type: 'setVariable', variable: 'n', op: 'add', value: 1 },
                  ],
                },
              ],
            },
            { type: 'setVariable', variable: 'n', op: 'add', value: 10 },
          ],
        },
        { type: 'setVariable', variable: 'n', op: 'add', value: 100 },
      ],
      state,
    );
    it.update(DT);
    it.choose(0);
    it.update(DT);
    expect(it.pending).toEqual({ type: 'message', speaker: null, text: 'inner' });
    it.continue();
    it.update(DT);
    expect(state.getVariable('n')).toBe(111);
    expect(it.isDone).toBe(true);
  });

  it('waits for the given time across updates, carrying leftover time forward', () => {
    const state = newState();
    const it = new Interpreter(
      [
        { type: 'wait', seconds: 0.5 },
        { type: 'setSwitch', switch: 'a', value: true },
        { type: 'wait', seconds: 0.25 },
        { type: 'setSwitch', switch: 'b', value: true },
      ],
      state,
    );
    it.update(0.3);
    expect(state.getSwitch('a')).toBe(false);
    it.update(0.3); // 0.5 reached with 0.1 left over toward the second wait
    expect([state.getSwitch('a'), state.getSwitch('b')]).toEqual([true, false]);
    it.update(0.1);
    expect(state.getSwitch('b')).toBe(false);
    it.update(0.05);
    expect(state.getSwitch('b')).toBe(true);
    expect(it.isDone).toBe(true);
  });

  it('is not done while a trailing wait is still counting down', () => {
    const it = new Interpreter([{ type: 'wait', seconds: 1 }], newState());
    it.update(0.5);
    expect(it.isDone).toBe(false);
    it.update(0.5);
    expect(it.isDone).toBe(true);
  });

  it('asks the host to perform transfers', () => {
    const it = new Interpreter(
      [
        { type: 'transfer', map: 'house', x: 3, y: 4, direction: 'up' },
        { type: 'transfer', map: 'meadow', x: 1, y: 1 },
      ],
      newState(),
    );
    it.update(DT);
    expect(it.pending).toEqual({ type: 'transfer', map: 'house', x: 3, y: 4, direction: 'up' });
    it.continue();
    it.update(DT);
    expect(it.pending).toEqual({ type: 'transfer', map: 'meadow', x: 1, y: 1, direction: null });
  });
});

describe('World.run', () => {
  function makeWorld() {
    return new World({ manifest: makeManifest(), map: makeMap(['.....']), tileset });
  }

  it('blocks player movement while an event runs, then releases it', () => {
    const world = makeWorld();
    const input = new ActionState();
    input.press('right');
    const event = world.run([say('Stop right there.')]);
    for (let i = 0; i < 60; i++) world.step(DT, input);
    expect(world.player.x).toBe(0);
    expect(world.interpreter).toBe(event);

    event.continue();
    for (let i = 0; i < 60; i++) world.step(DT, input);
    expect(world.interpreter).toBeNull();
    expect(world.player.x).toBeGreaterThan(0);
  });

  it('lets the player finish the tile it was already walking onto', () => {
    const world = makeWorld();
    const input = new ActionState();
    input.press('right');
    world.step(DT, input); // starts a step toward x=1
    world.run([say('Hold on.')]);
    for (let i = 0; i < 60; i++) world.step(DT, input);
    expect([world.player.x, world.player.isMoving]).toEqual([1, false]);
  });

  it('refuses to start a second blocking event', () => {
    const world = makeWorld();
    world.run([say('one')]);
    expect(() => world.run([say('two')])).toThrow(/already running/);
  });

  it('shares game state with the world', () => {
    const world = new World({
      manifest: { ...makeManifest(), switches: [{ id: 'met', name: 'Met' }] },
      map: makeMap(['.']),
      tileset,
    });
    world.run([{ type: 'setSwitch', switch: 'met', value: true }]);
    world.step(DT, new ActionState());
    expect(world.state.getSwitch('met')).toBe(true);
    expect(world.interpreter).toBeNull();
  });
});

describe('Interpreter battles', () => {
  const battle = (canEscape: boolean, canLose: boolean): Command => ({
    type: 'battle',
    troop: 'slimes',
    canEscape,
    canLose,
    onWin: [{ type: 'setSwitch', switch: 'a', value: true }],
    onEscape: [{ type: 'setSwitch', switch: 'b', value: true }],
    onLose: [{ type: 'setVariable', variable: 'n', op: 'set', value: -1 }],
  });

  it('asks the host to run the battle, then runs the outcome branch', () => {
    const state = newState();
    const it = new Interpreter([battle(true, true), say('after')], state);
    it.update(DT);
    expect(it.pending).toEqual({ type: 'battle', troop: 'slimes', canEscape: true, canLose: true });
    expect(() => it.continue()).toThrow(/a battle is pending/);
    it.finishBattle('escape');
    it.update(DT);
    expect([state.getSwitch('a'), state.getSwitch('b')]).toEqual([false, true]);
    expect(it.pending).toMatchObject({ type: 'message', text: 'after' });
  });

  it('runs the win and lose branches', () => {
    const winState = newState();
    const win = new Interpreter([battle(false, true)], winState);
    win.update(DT);
    win.finishBattle('win');
    win.update(DT);
    expect(winState.getSwitch('a')).toBe(true);

    const loseState = newState();
    const lose = new Interpreter([battle(false, true)], loseState);
    lose.update(DT);
    lose.finishBattle('lose');
    lose.update(DT);
    expect(loseState.getVariable('n')).toBe(-1);
  });

  it('refuses outcomes the battle does not allow', () => {
    const it = new Interpreter([battle(false, false)], newState());
    expect(() => it.finishBattle('win')).toThrow(/no battle is pending/);
    it.update(DT);
    expect(() => it.finishBattle('escape')).toThrow(/cannot be escaped/);
    expect(() => it.finishBattle('lose')).toThrow(/cannot be lost/);
    it.finishBattle('win');
    expect(it.pending).toBeNull();
  });
});
