// Event flags: each event's own on/off flags, keyed by map and event, so a
// chest can remember it was opened without a global switch per chest.
import type { Command, EventPage, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, GameState, World, evaluateCondition } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;
const say = (text: string): Command => ({ type: 'message', text });
const open: Command = { type: 'setFlag', flag: 'opened', value: true };
const isOpened = { type: 'flag', flag: 'opened', value: true } as const;

function page(overrides: Partial<EventPage> = {}): EventPage {
  return {
    conditions: [],
    trigger: 'action',
    layer: 'same',
    commands: [],
    graphic: { character: 'npc', direction: 'down' },
    ...overrides,
  };
}

/** A chest: opening it gives a message and sets "opened"; once opened, it says it's empty. */
function chest(id: string, x: number, y: number): MapEvent {
  return {
    id,
    name: id,
    x,
    y,
    pages: [
      page({ commands: [say(`${id}: found a potion`), open] }),
      page({ conditions: [isOpened], commands: [say(`${id}: empty`)] }),
    ],
  };
}

/** 5x5 open map, player at (2, 2) facing right. */
function setup(events: MapEvent[]) {
  const map = makeMap(['.....', '.....', '.....', '.....', '.....']);
  map.events = events;
  const manifest = makeManifest({ x: 2, y: 2, direction: 'right' });
  const world = new World({ manifest, map, tileset });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.step(DT, input);
      input.endStep();
    }
  };
  /** Press confirm to talk to what's ahead. */
  const confirm = () => {
    input.press('confirm');
    tick();
    input.release('confirm');
    tick();
  };
  /** Close the message that's up (the runtime's dialog does this in a game). */
  const close = () => {
    world.interpreter?.continue();
    tick();
  };
  const message = () => {
    const pending = world.interpreter?.pending;
    return pending?.type === 'message' ? pending.text : null;
  };
  return { world, map, manifest, tick, confirm, close, message };
}

describe('event flags', () => {
  it('lets an event remember something about itself', () => {
    const { world, confirm, close, message } = setup([chest('chest', 3, 2)]);
    confirm();
    expect(message()).toBe('chest: found a potion');
    close();
    expect(world.interpreter).toBeNull();
    expect(world.state.getFlag('test-map', 'chest', 'opened')).toBe(true);
    confirm();
    expect(message()).toBe('chest: empty');
  });

  it('shows an opened chest with its fixed facing instead of turning to the player', () => {
    const fixedChest = chest('chest', 3, 2);
    const [closed, opened] = fixedChest.pages;
    if (!closed || !opened) throw new Error('fixture');
    fixedChest.pages = [
      { ...closed, graphic: { character: 'chest', direction: 'down', fixed: true } },
      { ...opened, graphic: { character: 'chest', direction: 'up', fixed: true } },
    ];
    const { world, confirm, close } = setup([fixedChest]);
    const event = () => world.events.find((e) => e.id === 'chest');
    confirm();
    expect(event()?.direction).toBe('down'); // didn't turn toward the player (left)
    close();
    expect(event()?.direction).toBe('up');
  });

  it('turns people with a graphic to face the player', () => {
    const { world, confirm } = setup([chest('chest', 3, 2)]);
    confirm();
    expect(world.events.find((e) => e.id === 'chest')?.direction).toBe('left');
  });

  it('keeps each event’s flags apart, even with the same name', () => {
    const { world, confirm, close } = setup([chest('left', 3, 2), chest('right', 4, 4)]);
    confirm();
    close();
    expect(world.state.getFlag('test-map', 'left', 'opened')).toBe(true);
    expect(world.state.getFlag('test-map', 'right', 'opened')).toBe(false);
    expect(world.events.find((e) => e.id === 'right')?.pageIndex).toBe(0);
  });

  it('sets another event’s flag, and reads flags in an if', () => {
    const lever: MapEvent = {
      id: 'lever',
      name: 'Lever',
      x: 3,
      y: 2,
      pages: [
        page({
          commands: [
            { type: 'setFlag', flag: 'open', value: true, event: 'gate' },
            open,
            {
              type: 'if',
              conditions: [isOpened],
              then: [say('pulled')],
              else: [say('stuck')],
            },
          ],
        }),
      ],
    };
    const gate: MapEvent = {
      id: 'gate',
      name: 'Gate',
      x: 0,
      y: 0,
      pages: [page(), page({ conditions: [{ type: 'flag', flag: 'open', value: true }] })],
    };
    const { world, confirm, message } = setup([lever, gate]);
    confirm();
    expect(message()).toBe('pulled');
    expect(world.events.find((e) => e.id === 'gate')?.pageIndex).toBe(1);
  });

  it('keeps flags across map changes and in saves', () => {
    const { world, map, manifest, confirm, close } = setup([chest('chest', 3, 2)]);
    confirm();
    close();
    const other = { ...makeMap(['...']), id: 'other' };
    world.changeMap(other, tileset, 0, 0);
    expect(world.state.getFlag('test-map', 'chest', 'opened')).toBe(true);
    world.changeMap(map, tileset, 2, 2, 'right');
    expect(world.events.find((e) => e.id === 'chest')?.pageIndex).toBe(1);

    const save = world.toSave({ game: 'test', playSeconds: 1 });
    expect(save.flags).toEqual({ 'test-map': { chest: ['opened'] } });
    const loaded = World.fromSave(save, { manifest, map, tileset, database: world.db });
    expect(loaded.events.find((e) => e.id === 'chest')?.pageIndex).toBe(1);
  });

  it('turns flags off, and leaves flags that are off out of saves', () => {
    const state = new GameState();
    state.setFlag('m', 'e', 'a', true);
    state.setFlag('m', 'e', 'b', true);
    state.setFlag('m', 'e', 'a', false);
    state.setFlag('m', 'f', 'c', false);
    expect(state.toData().flags).toEqual({ m: { e: ['b'] } });
    const copy = new GameState();
    copy.loadData(state.toData());
    expect(copy.getFlag('m', 'e', 'b')).toBe(true);
    expect(copy.getFlag('m', 'e', 'a')).toBe(false);
  });

  it('explains a flag condition with no event to belong to', () => {
    expect(() => evaluateCondition(isOpened, new GameState())).toThrow(
      /flag condition needs a map event/,
    );
  });
});
