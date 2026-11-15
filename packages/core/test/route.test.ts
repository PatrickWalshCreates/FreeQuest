import type { Command, EventPage, MapEvent, MoveStep } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  ActionState,
  CollisionMap,
  GridMover,
  RouteRunner,
  World,
  resolveDirection,
} from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;
const move = (direction: Extract<MoveStep, { type: 'move' }>['direction']): MoveStep => ({
  type: 'move',
  direction,
});
const around = { player: { x: 0, y: 0 }, random: () => 0.6 };

describe('RouteRunner', () => {
  const open = CollisionMap.fromMap(makeMap(['.....', '.....', '.....']), tileset);

  function run(runner: RouteRunner, mover: GridMover, seconds: number) {
    for (let t = 0; t < seconds * 60; t++) runner.update(DT, mover, open, around);
  }

  it('walks, turns, waits and changes speed in order', () => {
    const mover = new GridMover({ x: 0, y: 1, direction: 'down', speed: 4 });
    const runner = new RouteRunner(
      [
        move('right'),
        { type: 'speed', speed: 8 },
        move('right'),
        { type: 'wait', seconds: 1 },
        { type: 'turn', direction: 'up' },
      ],
      { repeat: false, skipBlocked: false },
    );
    run(runner, mover, 0.5);
    expect([mover.x, mover.y]).toEqual([2, 1]);
    expect(mover.speed).toBe(8);
    expect(mover.direction).toBe('right');
    expect(runner.isDone(mover)).toBe(false);
    run(runner, mover, 1);
    expect(mover.direction).toBe('up');
    expect(runner.isDone(mover)).toBe(true);
  });

  it('waits at a blocked step, or skips it', () => {
    const walls = CollisionMap.fromMap(makeMap(['.#.']), tileset);
    const steps = [move('right'), { type: 'turn', direction: 'down' } as const];
    const stuck = new GridMover({ x: 0, y: 0, direction: 'up', speed: 4 });
    const waiting = new RouteRunner(steps, { repeat: false, skipBlocked: false });
    for (let t = 0; t < 60; t++) waiting.update(DT, stuck, walls, around);
    expect(stuck.direction).toBe('right');
    expect(waiting.isDone(stuck)).toBe(false);
    const skipper = new GridMover({ x: 0, y: 0, direction: 'up', speed: 4 });
    const skipping = new RouteRunner(steps, { repeat: false, skipBlocked: true });
    skipping.update(DT, skipper, walls, around);
    expect(skipper.direction).toBe('down');
    expect(skipping.isDone(skipper)).toBe(true);
  });

  it('repeats, and a repeating route of turns never hangs', () => {
    const mover = new GridMover({ x: 0, y: 0, direction: 'down', speed: 4 });
    const pacing = new RouteRunner([move('right'), move('left')], {
      repeat: true,
      skipBlocked: false,
    });
    run(pacing, mover, 2);
    expect(mover.x === 0 || mover.x === 1).toBe(true);
    expect(pacing.isDone(mover)).toBe(false);
    const spinner = new RouteRunner([{ type: 'turn', direction: 'around' }], {
      repeat: true,
      skipBlocked: false,
    });
    spinner.update(DT, mover, open, around);
    expect(spinner.isDone(mover)).toBe(false);
  });

  it('works out relative directions when the step runs', () => {
    const mover = new GridMover({ x: 3, y: 1, direction: 'left', speed: 4 });
    expect(resolveDirection('forward', mover, around)).toBe('left');
    expect(resolveDirection('around', mover, around)).toBe('right');
    expect(resolveDirection('toward-player', mover, around)).toBe('left');
    expect(resolveDirection('away-from-player', mover, around)).toBe('right');
    expect(resolveDirection('random', mover, around)).toBe('right');
  });
});

describe('moveRoute command', () => {
  const page = (overrides: Partial<EventPage> = {}): EventPage => ({
    conditions: [],
    trigger: 'action',
    layer: 'same',
    commands: [],
    graphic: { character: 'npc', direction: 'down' },
    ...overrides,
  });
  const event = (id: string, x: number, y: number, p: EventPage): MapEvent => ({
    id,
    name: id,
    x,
    y,
    pages: [p],
  });
  const route = (
    target: string,
    steps: MoveStep[],
    options: { wait?: boolean; repeat?: boolean } = {},
  ): Command => ({
    type: 'moveRoute',
    target,
    steps,
    repeat: options.repeat ?? false,
    skipBlocked: false,
    wait: options.wait ?? true,
  });

  function setup(events: MapEvent[]) {
    const map = makeMap(['......', '......', '......', '......']);
    map.events = events;
    const world = new World({
      manifest: {
        ...makeManifest({ x: 0, y: 0, direction: 'down' }),
        switches: [{ id: 'flag', name: 'Flag' }],
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
    return { world, input, tick };
  }

  it('walks "this" event and waits for it before the next command', () => {
    const { world, tick } = setup([
      event(
        'guard',
        3,
        1,
        page({
          trigger: 'autorun',
          conditions: [{ type: 'switch', switch: 'flag', value: false }],
          commands: [
            route('this', [move('right'), move('right')]),
            { type: 'setSwitch', switch: 'flag', value: true },
          ],
        }),
      ),
    ]);
    tick(20);
    expect(world.state.getSwitch('flag')).toBe(false);
    tick(60);
    expect(world.events[0]?.x).toBe(5);
    expect(world.state.getSwitch('flag')).toBe(true);
  });

  it('walks the player, ignoring the keys, and gives back its speed', () => {
    const { world, input, tick } = setup([
      event(
        'cutscene',
        5,
        3,
        page({
          trigger: 'autorun',
          layer: 'below',
          conditions: [{ type: 'switch', switch: 'flag', value: false }],
          commands: [
            route('player', [{ type: 'speed', speed: 8 }, move('down'), move('down')]),
            { type: 'setSwitch', switch: 'flag', value: true },
          ],
        }),
      ),
    ]);
    input.press('right');
    tick(2);
    expect(world.playerOnRoute).toBe(true);
    for (let i = 0; i < 60 && world.playerOnRoute; i++) tick();
    // Held "right" did nothing while the route walked the player down.
    expect([world.player.x, world.player.y]).toEqual([0, 2]);
    expect(world.player.speed).toBe(4);
    tick(30);
    expect(world.state.getSwitch('flag')).toBe(true);
    expect(world.player.x).toBeGreaterThan(0);
  });

  it('moves another event without waiting, and replaces its page movement meanwhile', () => {
    const { world, tick } = setup([
      // A long pause: it only wanders again well after the route.
      event('cat', 2, 2, page({ movement: { type: 'random', speed: 4, pause: 10 } })),
      event(
        'caller',
        5,
        0,
        page({
          trigger: 'parallel',
          layer: 'below',
          conditions: [{ type: 'switch', switch: 'flag', value: false }],
          commands: [
            route('cat', [move('up'), move('up')], { wait: false }),
            { type: 'setSwitch', switch: 'flag', value: true },
          ],
        }),
      ),
    ]);
    tick(1);
    expect(world.state.getSwitch('flag')).toBe(true);
    tick(40);
    expect([world.events[0]?.x, world.events[0]?.y]).toEqual([2, 0]);
  });

  it('walks a page route over and over', () => {
    const { world, tick } = setup([
      event(
        'guard',
        2,
        1,
        page({
          movement: { type: 'route', speed: 4, pause: 0, steps: [move('right'), move('left')] },
        }),
      ),
    ]);
    const xs = new Set<number>();
    for (let i = 0; i < 120; i++) {
      tick();
      xs.add(world.events[0]?.x ?? -1);
    }
    expect([...xs].sort()).toEqual([2, 3]);
  });
});

describe('route steps from 0.5', () => {
  // '#' is a wall.
  const map = CollisionMap.fromMap(makeMap(['.....', '..#..', '.....']), tileset);
  const runSteps = (mover: GridMover, steps: MoveStep[], seconds = 3, extra = {}) => {
    const runner = new RouteRunner(steps, { repeat: false, skipBlocked: true });
    const surroundings = { ...around, ...extra };
    for (let t = 0; t < seconds * 60 && !runner.isDone(mover); t++) {
      runner.update(DT, mover, map, surroundings);
    }
    return runner;
  };

  it('moves diagonally past a corner, but not into a wall', () => {
    // From (2, 0) down-left to (1, 1): the wall at (2, 1) is beside the way, (1, 0) is open.
    const mover = new GridMover({ x: 2, y: 0, direction: 'down', speed: 4 });
    runSteps(mover, [move('down-left')]);
    expect([mover.x, mover.y, mover.direction]).toEqual([1, 1, 'left']);
    // From (1, 0) down-right is the wall itself: it only turns.
    const blocked = new GridMover({ x: 1, y: 0, direction: 'down', speed: 4 });
    runSteps(blocked, [move('down-right')]);
    expect([blocked.x, blocked.y, blocked.direction]).toEqual([1, 0, 'right']);
  });

  it('steps backward keeping its facing, and turns a quarter at a time', () => {
    const mover = new GridMover({ x: 2, y: 2, direction: 'right', speed: 4 });
    runSteps(mover, [move('backward'), { type: 'turn', direction: 'clockwise' }]);
    expect([mover.x, mover.y, mover.direction]).toEqual([1, 2, 'down']);
  });

  it('jumps on the spot and over a wall, landing only on open tiles', () => {
    const mover = new GridMover({ x: 2, y: 0, direction: 'down', speed: 4 });
    const runner = new RouteRunner([{ type: 'jump', x: 0, y: 2 }], {
      repeat: false,
      skipBlocked: false,
    });
    runner.update(DT, mover, map, around);
    runner.update(DT * 10, mover, map, around);
    expect(mover.jumpHeight).toBeGreaterThan(0);
    for (let t = 0; t < 120 && !runner.isDone(mover); t++) runner.update(DT, mover, map, around);
    expect([mover.x, mover.y, mover.jumpHeight]).toEqual([2, 2, 0]);
    // Onto the wall: it can't, so (not skipping) it waits.
    const stuck = new GridMover({ x: 2, y: 0, direction: 'down', speed: 4 });
    const blocked = new RouteRunner([{ type: 'jump', x: 0, y: 1 }], {
      repeat: false,
      skipBlocked: false,
    });
    for (let t = 0; t < 60; t++) blocked.update(DT, stuck, map, around);
    expect([stuck.y, blocked.isDone(stuck)]).toEqual([0, false]);
    const spot = new GridMover({ x: 0, y: 0, direction: 'down', speed: 4 });
    runSteps(spot, [{ type: 'jump', x: 0, y: 0 }]);
    expect([spot.x, spot.y]).toEqual([0, 0]);
  });

  it('walks through walls, keeps its facing, and changes how it looks', () => {
    const mover = new GridMover({ x: 2, y: 0, direction: 'down', speed: 4 });
    runSteps(mover, [
      { type: 'through', on: true },
      { type: 'fixFacing', on: true },
      move('down'),
      { type: 'turn', direction: 'left' },
      { type: 'character', character: 'ghost' },
      { type: 'hidden', on: true },
      { type: 'walkAnimation', on: false },
      { type: 'stepAnimation', on: true },
    ]);
    expect([mover.x, mover.y, mover.direction]).toEqual([2, 1, 'down']);
    expect(mover).toMatchObject({
      character: 'ghost',
      hidden: true,
      walkAnimation: false,
      stepAnimation: true,
    });
    // Stepping in place animates while standing.
    const before = mover.distanceWalked;
    mover.idle(1);
    expect(mover.distanceWalked).toBeGreaterThan(before);
    expect(mover.isAnimating).toBe(true);
    mover.resetLooks();
    expect(mover).toMatchObject({
      character: null,
      hidden: false,
      through: false,
      facingFixed: false,
    });
  });

  it('plays sounds and sets switches through the world', () => {
    const sounds: string[] = [];
    const switches: [string, boolean][] = [];
    runSteps(
      new GridMover({ x: 0, y: 0, direction: 'down', speed: 4 }),
      [
        { type: 'sound', path: 'assets/audio/step.wav' },
        { type: 'switch', switch: 'door', value: true },
      ],
      1,
      {
        playSound: (p: string) => sounds.push(p),
        setSwitch: (id: string, v: boolean) => switches.push([id, v]),
      },
    );
    expect(sounds).toEqual(['assets/audio/step.wav']);
    expect(switches).toEqual([['door', true]]);
  });
});
