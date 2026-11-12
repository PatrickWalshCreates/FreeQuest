// Common events: command lists kept in the database and shared. Called from
// any event, or started by the game itself (autorun, parallel) while their
// switch is on.
import {
  type Command,
  type CommonEventEntry,
  type MapEvent,
  emptyDatabase,
} from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, DatabaseIndex, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;
const say = (text: string): Command => ({ type: 'message', text });

function common(
  id: string,
  commands: Command[],
  trigger: CommonEventEntry['trigger'] = 'call',
  gate?: string,
): CommonEventEntry {
  return { id, name: id, trigger, ...(gate ? { switch: gate } : {}), commands };
}

/** 5x5 open map, player at (2, 2) facing right, with these common events. */
function setup(commons: CommonEventEntry[], events: MapEvent[] = []) {
  const map = makeMap(['.....', '.....', '.....', '.....', '.....']);
  map.events = events;
  const world = new World({
    manifest: {
      ...makeManifest({ x: 2, y: 2, direction: 'right' }),
      switches: [{ id: 'on', name: 'On' }],
      variables: [{ id: 'count', name: 'Count' }],
    },
    map,
    tileset,
    database: new DatabaseIndex({ ...emptyDatabase(), commonEvents: commons }),
  });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.step(DT, input);
      input.endStep();
    }
  };
  const message = () => {
    const pending = world.interpreter?.pending;
    return pending?.type === 'message' ? pending.text : null;
  };
  return { world, map, input, tick, message };
}

const count = (by = 1): Command => ({
  type: 'setVariable',
  variable: 'count',
  op: 'add',
  value: by,
});

describe('common events', () => {
  it('runs a called common event, then carries on after the call', () => {
    const { world, tick, message } = setup([common('greet', [say('hello'), count()])]);
    world.run([{ type: 'callCommon', common: 'greet' }, say('and back'), count(10)]);
    tick();
    expect(message()).toBe('hello');
    world.interpreter?.continue();
    tick();
    expect(message()).toBe('and back');
    world.interpreter?.continue();
    tick();
    expect(world.interpreter).toBeNull();
    expect(world.state.getVariable('count')).toBe(11);
  });

  it('runs called commands as the calling event (its flags)', () => {
    const lid: Command = { type: 'setFlag', flag: 'opened', value: true };
    const box: MapEvent = {
      id: 'box',
      name: 'Box',
      x: 3,
      y: 2,
      pages: [
        {
          conditions: [],
          trigger: 'action',
          layer: 'same',
          commands: [{ type: 'callCommon', common: 'open' }],
        },
      ],
    };
    const { world, input, tick } = setup([common('open', [lid])], [box]);
    input.press('confirm');
    tick(2);
    expect(world.state.getFlag('test-map', 'box', 'opened')).toBe(true);
  });

  it('starts an autorun common event while its switch is on, until it turns it off', () => {
    const intro = common(
      'intro',
      [count(), { type: 'setSwitch', switch: 'on', value: false }],
      'autorun',
      'on',
    );
    const { world, tick } = setup([intro]);
    tick(5);
    expect(world.state.getVariable('count')).toBe(0);
    world.state.setSwitch('on', true);
    tick(5);
    expect(world.state.getVariable('count')).toBe(1);
    expect(world.state.getSwitch('on')).toBe(false);
  });

  it('runs a parallel common event every step while its switch is on, also across maps', () => {
    const { world, map, tick } = setup([common('clock', [count()], 'parallel', 'on')]);
    tick(3);
    expect(world.state.getVariable('count')).toBe(0);
    world.state.setSwitch('on', true);
    tick(3);
    expect(world.state.getVariable('count')).toBe(3);
    world.changeMap({ ...map, id: 'other' }, tileset, 0, 0);
    tick(2);
    expect(world.state.getVariable('count')).toBe(5);
    world.state.setSwitch('on', false);
    tick(3);
    expect(world.state.getVariable('count')).toBe(5);
  });

  it('runs an ungated parallel common event always, and shows its messages in turn', () => {
    const { world, tick, message } = setup([
      common('note', [say('tick'), { type: 'wait', seconds: 10 }], 'parallel'),
    ]);
    tick();
    expect(world.parallelCommonEvents).toEqual([]);
    expect(world.interpreterCommonEvent).toBe('note');
    expect(message()).toBe('tick');
    world.interpreter?.continue();
    tick();
    expect(world.interpreter).not.toBeNull(); // waiting out its 10 s as the running event
  });

  it('stops a common event that calls itself with a clear error', () => {
    const { world, tick } = setup([common('loop', [{ type: 'callCommon', common: 'loop' }])]);
    world.run([{ type: 'callCommon', common: 'loop' }]);
    expect(() => tick()).toThrow(/calls nest 100 deep; does one call itself/);
  });
});
