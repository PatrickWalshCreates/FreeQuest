import type { GameMap, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;

function setup(map: GameMap, random: () => number) {
  const world = new World({ manifest: makeManifest({ x: 0, y: 0 }), map, tileset, random });
  const input = new ActionState();
  /** Walk right until an encounter is pending (or `max` steps). Returns steps taken. */
  const walk = (max = 50) => {
    input.press('right');
    let steps = 0;
    let last = world.player.x;
    for (let i = 0; i < max * 20; i++) {
      world.step(DT, input);
      input.endStep();
      if (world.player.x !== last) {
        last = world.player.x;
        steps++;
      }
      if (world.hasPendingEncounter) break;
    }
    input.release('right');
    return steps;
  };
  return { world, input, walk };
}

const field = (steps: number, troops = [{ troop: 'slimes', weight: 1 }]): GameMap => ({
  ...makeMap(['.'.repeat(60)]),
  encounters: { steps, troops },
});

describe('random encounters', () => {
  it('triggers after a randomized number of steps around the average', () => {
    // random 0.5 → exactly the average (10 steps).
    const { world, walk } = setup(field(10), () => 0.5);
    expect(walk()).toBe(10);
    expect(world.takeEncounter()).toBe('slimes');
    expect(world.takeEncounter()).toBeNull(); // handed over once
  });

  it('holds the player still while an encounter is pending', () => {
    const { world, walk, input } = setup(field(3), () => 0.5);
    walk();
    const x = world.player.x;
    input.press('right');
    for (let i = 0; i < 60; i++) world.step(DT, input);
    expect(world.player.x).toBe(x);
    world.takeEncounter();
    for (let i = 0; i < 30; i++) world.step(DT, input);
    expect(world.player.x).toBeGreaterThan(x);
  });

  it('picks troops by weight', () => {
    const troops = [
      { troop: 'common', weight: 3 },
      { troop: 'rare', weight: 1 },
    ];
    const low = setup(field(1, troops), () => 0.1); // roll 0.4 of 4 → common
    low.walk();
    expect(low.world.takeEncounter()).toBe('common');
    const high = setup(field(1, troops), () => 0.9); // roll 3.6 of 4 → rare
    high.walk();
    expect(high.world.takeEncounter()).toBe('rare');
  });

  it('never happens on maps without encounters', () => {
    const { world, walk } = setup(makeMap(['.'.repeat(60)]), () => 0);
    walk(40);
    expect(world.takeEncounter()).toBeNull();
  });

  it('does not start a fight on a step that triggered an event', () => {
    const trap: MapEvent = {
      id: 'trap',
      name: 'Trap',
      x: 1,
      y: 0,
      pages: [{ conditions: [], trigger: 'touch', layer: 'below', commands: [] }],
    };
    const map = { ...field(1), events: [trap] };
    const { world, input } = setup(map, () => 0); // 1 step
    input.press('right');
    for (let i = 0; i < 16; i++) world.step(DT, input); // exactly onto (1, 0)
    expect(world.takeEncounter()).toBeNull();
  });

  it('restarts the countdown on a new map', () => {
    const { world } = setup(field(10), () => 0.5);
    world.changeMap(field(4), tileset, 0, 0);
    const input = new ActionState();
    input.press('right');
    let steps = 0;
    let last = 0;
    for (let i = 0; i < 400 && steps < 4; i++) {
      world.step(DT, input);
      if (world.player.x !== last) {
        last = world.player.x;
        steps++;
      }
    }
    for (let i = 0; i < 20; i++) world.step(DT, input);
    expect(world.takeEncounter()).toBe('slimes');
  });
});
