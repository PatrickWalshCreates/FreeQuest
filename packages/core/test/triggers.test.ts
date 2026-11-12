import type { Command, EventPage, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, type Direction, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;
const say = (text: string): Command => ({ type: 'message', text });

function page(overrides: Partial<EventPage> = {}): EventPage {
  return {
    conditions: [],
    trigger: 'action',
    layer: 'same',
    commands: [say('hi')],
    graphic: { character: 'npc', direction: 'down' },
    ...overrides,
  };
}

function event(id: string, x: number, y: number, ...pages: EventPage[]): MapEvent {
  return { id, name: id, x, y, pages: pages.length > 0 ? pages : [page()] };
}

/** 5x5 open map, player at (2, 2) facing `direction`. */
function setup(events: MapEvent[], direction: Direction = 'down') {
  const map = makeMap(['.....', '.....', '.....', '.....', '.....']);
  map.events = events;
  const world = new World({
    manifest: {
      ...makeManifest({ x: 2, y: 2, direction }),
      switches: [{ id: 'flag', name: 'Flag' }],
      variables: [{ id: 'count', name: 'Count' }],
    },
    map,
    tileset,
  });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.step(DT, input);
      input.endStep();
    }
  };
  const tap = (action: 'confirm') => {
    input.press(action);
    tick();
    input.release(action);
  };
  return { world, input, tick, tap };
}

describe('event collision', () => {
  it('blocks the player with events on the same layer only', () => {
    const { world, input, tick } = setup([
      event('wall', 3, 2),
      event('rug', 2, 3, page({ layer: 'below' })),
    ]);
    input.press('right');
    tick(60);
    expect(world.player.x).toBe(2);
    input.release('right');
    input.press('down');
    tick(15);
    expect(world.player.y).toBe(3);
  });

  it('ignores events with no active page', () => {
    const hidden = page({ conditions: [{ type: 'switch', switch: 'flag', value: true }] });
    const { world, input, tick } = setup([event('ghost', 3, 2, hidden)]);
    input.press('right');
    tick(15);
    expect(world.player.x).toBe(3);
  });

  it('starts blocking as soon as a switch reveals the event', () => {
    const shown = page({ conditions: [{ type: 'switch', switch: 'flag', value: true }] });
    const { world, input, tick } = setup([event('ghost', 3, 2, shown)]);
    world.state.setSwitch('flag', true);
    input.press('right');
    tick(30);
    expect(world.player.x).toBe(2);
  });
});

describe('action trigger', () => {
  it('runs the event the player faces when confirm is pressed, and the NPC turns', () => {
    const { world, tap } = setup([event('npc', 2, 3)], 'down');
    tap('confirm');
    expect(world.interpreterEvent?.id).toBe('npc');
    expect(world.interpreter?.pending).toMatchObject({
      type: 'message',
      speaker: null,
      text: 'hi',
    });
    expect(world.events[0]?.direction).toBe('up');
  });

  it('does nothing when the player faces away', () => {
    const { world, tap } = setup([event('npc', 2, 3)], 'up');
    tap('confirm');
    expect(world.interpreter).toBeNull();
  });

  it('does not turn events without a graphic', () => {
    const sign = page();
    delete sign.graphic;
    const { world, tap } = setup([event('sign', 2, 1, sign)], 'up');
    tap('confirm');
    expect(world.interpreterEvent?.id).toBe('sign');
    expect(world.events[0]?.direction).toBe('down');
  });

  it('runs a below-layer action event the player stands on', () => {
    const { world, tap } = setup([event('item', 2, 2, page({ layer: 'below' }))]);
    tap('confirm');
    expect(world.interpreterEvent?.id).toBe('item');
  });

  it('ignores confirm while walking', () => {
    const { world, input, tick, tap } = setup([event('npc', 2, 4)], 'down');
    input.press('down');
    tick(); // step toward (2, 3) begins
    tap('confirm');
    expect(world.interpreter).toBeNull();
  });

  it('does not restart the conversation with the confirm that closes it', () => {
    const { world, tap } = setup([event('npc', 2, 3)], 'down');
    tap('confirm');
    const talk = world.interpreter;
    // The runtime answers the message on the same confirm press, before the step.
    talk?.continue();
    tap('confirm');
    expect(world.interpreter).toBeNull();
    // A fresh press afterwards talks again.
    tap('confirm');
    expect(world.interpreter).not.toBeNull();
    expect(world.interpreter).not.toBe(talk);
  });

  it('keeps the NPC facing the player when its page changes mid-conversation', () => {
    const before = page({
      commands: [{ type: 'setSwitch', switch: 'flag', value: true }, say('noted')],
    });
    const after = page({
      conditions: [{ type: 'switch', switch: 'flag', value: true }],
      graphic: { character: 'npc', direction: 'left' },
    });
    const { world, tap, tick } = setup([event('npc', 2, 3, before, after)], 'down');
    tap('confirm');
    expect(world.events[0]?.pageIndex).toBe(1);
    expect(world.events[0]?.direction).toBe('up');
    world.interpreter?.continue();
    tick();
    expect(world.interpreter).toBeNull();
    expect(world.events[0]?.direction).toBe('up');
  });
});

describe('touch trigger', () => {
  it('fires on arriving at a walk-over event and stops the player there', () => {
    const { world, input, tick } = setup([
      event('trap', 2, 3, page({ trigger: 'touch', layer: 'below' })),
    ]);
    input.press('down');
    tick(60);
    expect(world.interpreterEvent?.id).toBe('trap');
    expect([world.player.y, world.player.isMoving]).toEqual([3, false]);
  });

  it('fires when walking into a blocking event', () => {
    const { world, input, tick } = setup([
      event('guard', 3, 2, page({ trigger: 'touch', layer: 'same' })),
    ]);
    input.press('right');
    tick();
    expect(world.interpreterEvent?.id).toBe('guard');
    expect(world.player.x).toBe(2);
  });

  it('does not fire for the tile the player starts on', () => {
    const { world, tick } = setup([event('mat', 2, 2, page({ trigger: 'touch', layer: 'below' }))]);
    tick(5);
    expect(world.interpreter).toBeNull();
  });

  it('is not triggered by pressing confirm', () => {
    const { world, tap } = setup([event('guard', 2, 3, page({ trigger: 'touch' }))]);
    tap('confirm');
    expect(world.interpreter).toBeNull();
  });
});

describe('autorun trigger', () => {
  it('runs on its own and stops once its page is switched off', () => {
    const intro = page({
      trigger: 'autorun',
      layer: 'below',
      conditions: [{ type: 'switch', switch: 'flag', value: false }],
      commands: [say('Welcome!'), { type: 'setSwitch', switch: 'flag', value: true }],
    });
    const { world, input, tick } = setup([event('intro', 0, 0, intro)]);
    tick();
    expect(world.interpreter?.pending).toMatchObject({ text: 'Welcome!' });
    world.interpreter?.continue();
    tick(3);
    expect(world.interpreter).toBeNull();
    expect(world.events[0]?.page).toBeNull();
    input.press('right');
    tick(15);
    expect(world.player.x).toBe(3);
  });
});

describe('parallel trigger', () => {
  const count = (by = 1): Command => ({
    type: 'setVariable',
    variable: 'count',
    op: 'add',
    value: by,
  });
  const wait = (seconds: number): Command => ({ type: 'wait', seconds });
  const parallel = (commands: Command[], overrides: Partial<EventPage> = {}) =>
    page({ trigger: 'parallel', layer: 'below', commands, ...overrides });

  it('runs alongside play, once per step without waits, and never blocks the player', () => {
    const { world, input, tick } = setup([event('ticker', 0, 0, parallel([count()]))]);
    tick(10);
    expect(world.state.getVariable('count')).toBe(10);
    expect(world.interpreter).toBeNull();
    input.press('right');
    tick(15);
    expect(world.player.x).toBe(3);
  });

  it('keeps time with waits and starts again after each pass', () => {
    const { world, tick } = setup([event('clock', 0, 0, parallel([wait(0.5), count()]))]);
    tick(29);
    expect(world.state.getVariable('count')).toBe(0);
    expect(world.parallelEvents.map((e) => e.id)).toEqual(['clock']);
    tick(1);
    expect(world.state.getVariable('count')).toBe(1);
    tick(60);
    expect(world.state.getVariable('count')).toBe(3);
  });

  it('keeps running while a blocking event shows a message', () => {
    const { world, tap, tick } = setup([
      event('npc', 2, 3),
      event('ticker', 0, 0, parallel([count()])),
    ]);
    tap('confirm');
    expect(world.interpreter?.pending).toMatchObject({ text: 'hi' });
    const before = world.state.getVariable('count');
    tick(5);
    expect(world.state.getVariable('count')).toBe(before + 5);
  });

  it('takes the screen for a message once nothing else runs, and the player waits', () => {
    const { world, input, tap, tick } = setup([
      event('npc', 2, 3),
      event('timer', 0, 0, parallel([wait(0.2), say('Time!'), count()])),
    ]);
    tap('confirm');
    expect(world.interpreter?.pending).toMatchObject({ text: 'hi' });
    tick(20);
    // The NPC's message is still up: the timer's message waits its turn.
    expect(world.interpreter?.pending).toMatchObject({ text: 'hi' });
    world.interpreter?.continue();
    tick();
    expect(world.interpreter?.pending).toMatchObject({ text: 'Time!' });
    expect(world.interpreterEvent?.id).toBe('timer');
    input.press('right');
    tick(15);
    expect(world.player.x).toBe(2);
    world.interpreter?.continue();
    tick();
    expect(world.state.getVariable('count')).toBe(1);
  });

  it('finishes a pass when its page changes, then stops', () => {
    const once = parallel(
      [{ type: 'setSwitch', switch: 'flag', value: true }, wait(0.1), count()],
      {
        conditions: [{ type: 'switch', switch: 'flag', value: false }],
      },
    );
    const { world, tick } = setup([event('once', 0, 0, once)]);
    tick(30);
    expect(world.state.getSwitch('flag')).toBe(true);
    expect(world.state.getVariable('count')).toBe(1);
    expect(world.parallelEvents).toEqual([]);
  });

  it('stops on a map change and is never saved', () => {
    const { world, tick } = setup([event('clock', 0, 0, parallel([wait(1), count()]))]);
    tick(10);
    expect(world.parallelEvents).toHaveLength(1);
    expect(() => world.toSave({ game: 'test-game', playSeconds: 1 })).not.toThrow();
    world.changeMap(makeMap(['...', '...']), tileset, 0, 0);
    expect(world.parallelEvents).toEqual([]);
  });
});
