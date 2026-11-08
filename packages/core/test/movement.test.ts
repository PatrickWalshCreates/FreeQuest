import { describe, expect, it } from 'vitest';
import { ActionState, CollisionMap, type Direction, GridMover, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const open = CollisionMap.fromMap(makeMap(['.....', '.....', '.....']), tileset);
const DT = 1 / 60;

function run(mover: GridMover, seconds: number, dir: Direction | null, map = open): void {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) mover.update(DT, map, () => dir);
}

describe('GridMover', () => {
  it('stays put with no input', () => {
    const m = new GridMover({ x: 1, y: 1, direction: 'down', speed: 4 });
    run(m, 1, null);
    expect([m.x, m.y, m.isMoving]).toEqual([1, 1, false]);
  });

  it('tweens smoothly between tiles and lands exactly on the target', () => {
    const m = new GridMover({ x: 1, y: 1, direction: 'down', speed: 4 });
    expect(m.tryStep('right', open)).toBe(true);
    expect(m.x).toBe(2); // logical tile is the destination immediately
    expect(m.realX).toBe(1);

    m.update(0.125, open, () => null); // half a tile at 4 tiles/s
    expect(m.isMoving).toBe(true);
    expect(m.realX).toBeCloseTo(1.5);

    m.update(0.125, open, () => null);
    expect(m.isMoving).toBe(false);
    expect([m.realX, m.realY]).toEqual([2, 1]);
  });

  it('moves one tile per (1 / speed) seconds while a direction is held', () => {
    const m = new GridMover({ x: 0, y: 0, direction: 'down', speed: 4 });
    run(m, 0.5, 'right');
    expect(m.realX).toBeCloseTo(2, 6);
    expect(m.distanceWalked).toBeCloseTo(2, 6);
  });

  it('chains steps without stopping when a step ends mid-frame', () => {
    const m = new GridMover({ x: 0, y: 0, direction: 'down', speed: 4 });
    m.update(0.3, open, () => 'right'); // 1.2 tiles of travel
    expect(m.x).toBe(2);
    expect(m.realX).toBeCloseTo(1.2);
  });

  it('only turns when the target tile is blocked', () => {
    const map = CollisionMap.fromMap(makeMap(['.#', '..']), tileset);
    const m = new GridMover({ x: 0, y: 0, direction: 'down', speed: 4 });
    expect(m.tryStep('right', map)).toBe(false);
    expect(m.direction).toBe('right');
    expect([m.x, m.y, m.isMoving]).toEqual([0, 0, false]);
  });

  it('cannot walk off the map edge', () => {
    const m = new GridMover({ x: 0, y: 0, direction: 'down', speed: 8 });
    run(m, 2, 'up');
    run(m, 2, 'left');
    expect([m.x, m.y]).toEqual([0, 0]);
    expect(m.direction).toBe('left');
  });

  it('stops against a wall after walking toward it', () => {
    const map = CollisionMap.fromMap(makeMap(['...#.']), tileset);
    const m = new GridMover({ x: 0, y: 0, direction: 'right', speed: 4 });
    run(m, 3, 'right', map);
    expect([m.x, m.isMoving]).toEqual([2, false]);
  });

  it('ignores new directions until the current step finishes', () => {
    const m = new GridMover({ x: 1, y: 1, direction: 'down', speed: 4 });
    m.update(0.1, open, () => 'right');
    m.update(0.1, open, () => 'down');
    expect([m.x, m.y]).toEqual([2, 1]);
    m.update(0.1, open, () => 'down');
    expect([m.x, m.y]).toEqual([2, 2]);
  });
});

describe('ActionState', () => {
  it('prefers the most recently pressed held direction', () => {
    const input = new ActionState();
    input.press('up');
    input.press('left');
    expect(input.heldDirection()).toBe('left');
    input.release('left');
    expect(input.heldDirection()).toBe('up');
    input.release('up');
    expect(input.heldDirection()).toBeNull();
  });

  it('reports justPressed for one step only', () => {
    const input = new ActionState();
    input.press('confirm');
    expect(input.justPressed('confirm')).toBe(true);
    input.endStep();
    expect(input.justPressed('confirm')).toBe(false);
    expect(input.isDown('confirm')).toBe(true);
  });
});

describe('World', () => {
  it('moves the player from input and respects collision', () => {
    const world = new World({
      manifest: makeManifest({ x: 0, y: 0 }),
      map: makeMap(['..#']),
      tileset,
    });
    const input = new ActionState();
    input.press('right');
    for (let i = 0; i < 120; i++) {
      world.step(DT, input);
      input.endStep();
    }
    expect(world.player.x).toBe(1);
    expect(world.player.direction).toBe('right');
  });

  it('rejects a start position outside the map', () => {
    expect(
      () => new World({ manifest: makeManifest({ x: 9, y: 0 }), map: makeMap(['..']), tileset }),
    ).toThrow(/outside/);
  });
});
