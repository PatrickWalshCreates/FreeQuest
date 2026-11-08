import type { GameMap, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;

function named(map: GameMap, id: string, events: MapEvent[] = []): GameMap {
  return { ...map, id, events };
}

const door: MapEvent = {
  id: 'door',
  name: 'Door',
  x: 2,
  y: 0,
  pages: [
    {
      conditions: [],
      trigger: 'touch',
      layer: 'below',
      commands: [
        { type: 'transfer', map: 'inside', x: 1, y: 1, direction: 'up' },
        { type: 'message', text: 'It is dark in here.' },
      ],
    },
  ],
};

const outside = named(makeMap(['...', '...']), 'outside', [door]);
const inside = named(makeMap(['....', '....', '....']), 'inside', [
  {
    id: 'cat',
    name: 'Cat',
    x: 3,
    y: 2,
    pages: [{ conditions: [], trigger: 'action', layer: 'same', commands: [] }],
  },
]);

function setup() {
  const world = new World({ manifest: makeManifest({ x: 0, y: 0 }), map: outside, tileset });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.step(DT, input);
      input.endStep();
    }
  };
  return { world, input, tick };
}

describe('World.changeMap', () => {
  it('swaps map, collision and events, and places the player', () => {
    const { world } = setup();
    world.changeMap(inside, tileset, 1, 2, 'left');
    expect(world.map.id).toBe('inside');
    expect(world.collision.width).toBe(4);
    expect(world.passability.width).toBe(4);
    expect(world.events.map((e) => e.id)).toEqual(['cat']);
    expect([world.player.x, world.player.y, world.player.direction]).toEqual([1, 2, 'left']);
    expect(world.player.isMoving).toBe(false);
  });

  it('keeps the facing direction when none is given', () => {
    const { world } = setup();
    world.player.direction = 'right';
    world.changeMap(inside, tileset, 0, 0);
    expect(world.player.direction).toBe('right');
  });

  it('rejects positions outside the new map and mismatched tilesets', () => {
    const { world } = setup();
    expect(() => world.changeMap(inside, tileset, 4, 0)).toThrow(/outside map "inside"/);
    expect(() => world.changeMap(inside, { ...tileset, id: 'other' }, 0, 0)).toThrow(/tileset/);
    expect(world.map.id).toBe('outside'); // unchanged after a failed change
  });

  it('blocks movement against the new map', () => {
    const { world, input, tick } = setup();
    world.changeMap(inside, tileset, 0, 2);
    input.press('right');
    tick(120);
    expect(world.player.x).toBe(2); // the cat at (3, 2) blocks
  });

  it('runs a door: transfer, then the same event keeps going on the new map', () => {
    const { world, input, tick } = setup();
    input.press('right');
    tick(40); // walk onto the door at (2, 0); the event stops the player there
    const request = world.interpreter?.pending;
    expect(request).toEqual({ type: 'transfer', map: 'inside', x: 1, y: 1, direction: 'up' });

    // What the runtime does once the target map has loaded:
    world.changeMap(inside, tileset, 1, 1, 'up');
    expect(world.interpreterEvent).toBeNull();
    world.interpreter?.continue();
    tick();

    expect(world.map.id).toBe('inside');
    expect(world.interpreter?.pending).toEqual({
      type: 'message',
      speaker: null,
      text: 'It is dark in here.',
    });
    world.interpreter?.continue();
    tick();
    expect(world.interpreter).toBeNull();
    expect([world.player.x, world.player.y]).toEqual([1, 1]);
  });
});
