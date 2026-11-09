import { ActionState, World } from '@freequest/core';
import type { Command, GameMap, Manifest, Tileset } from '@freequest/schema';
import { describe, expect, it, vi } from 'vitest';
import { type LoadedMap, TransferController } from '../src/transfer.js';

const DT = 1 / 60;

const tileset: Tileset = {
  formatVersion: 1,
  id: 'ts',
  name: 'TS',
  image: 'ts.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: 1,
  tiles: [{ passable: true }],
};

function map(id: string, width: number, height: number): GameMap {
  return {
    formatVersion: 5,
    id,
    name: id,
    width,
    height,
    tileset: 'ts',
    layers: [{ name: 'g', data: Array.from({ length: height }, () => Array(width).fill(0)) }],
    events: [],
  };
}

const manifest: Manifest = {
  formatVersion: 4,
  name: 'T',
  screen: { width: 64, height: 64 },
  start: { map: 'a', x: 0, y: 0, direction: 'down', party: [], gold: 0 },
  player: { character: 'hero', speed: 4 },
  tilesets: [],
  maps: [],
  characters: [],
  switches: [],
  variables: [],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let resolved promises run their callbacks. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function setup(commands: Command[], fadeSeconds = 0.25) {
  const world = new World({ manifest, map: map('a', 3, 3), tileset });
  const load = deferred<LoadedMap>();
  const loadMap = vi.fn(() => load.promise);
  const onError = vi.fn();
  const transfer = new TransferController(loadMap, { fadeSeconds, onError });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      transfer.update(DT, world);
      world.step(DT, input);
      input.endStep();
    }
  };
  world.run(commands);
  world.step(DT, input); // run to the transfer request
  return { world, transfer, load, loadMap, onError, tick };
}

const toB: Command = { type: 'transfer', map: 'b', x: 4, y: 1, direction: 'left' };

describe('TransferController', () => {
  it('fades out, swaps the map, fades in, then lets the event continue', async () => {
    const { world, transfer, load, loadMap, tick } = setup([
      toB,
      { type: 'message', text: 'arrived' },
    ]);
    tick();
    expect(loadMap).toHaveBeenCalledWith('b');
    expect(transfer.isActive).toBe(true);
    load.resolve({ map: map('b', 5, 5), tileset });
    await flush();

    tick(7);
    expect(transfer.fade).toBeGreaterThan(0.4);
    expect(world.map.id).toBe('a'); // not swapped until fully black

    tick(10);
    expect(world.map.id).toBe('b');
    expect([world.player.x, world.player.y, world.player.direction]).toEqual([4, 1, 'left']);
    expect(world.interpreter?.pending?.type).toBe('transfer'); // still fading in

    tick(16);
    expect(transfer.isActive).toBe(false);
    expect(transfer.fade).toBe(0);
    expect(world.interpreter?.pending).toMatchObject({ type: 'message', text: 'arrived' });
  });

  it('holds on black while a slow map is still loading', async () => {
    const { world, transfer, load, tick } = setup([toB]);
    tick(60);
    expect(transfer.fade).toBe(1);
    expect(world.map.id).toBe('a');
    load.resolve({ map: map('b', 5, 5), tileset });
    await flush();
    tick();
    expect(world.map.id).toBe('b');
  });

  it('switches instantly with a zero fade', async () => {
    const { world, transfer, load, tick } = setup([toB], 0);
    tick();
    load.resolve({ map: map('b', 5, 5), tileset });
    await flush();
    tick(2);
    expect(world.map.id).toBe('b');
    expect(transfer.isActive).toBe(false);
  });

  it('reports a failed load, stays on the map and continues the event once', async () => {
    const { world, load, onError, tick } = setup([toB, { type: 'message', text: 'after' }]);
    tick();
    load.reject(new Error('404'));
    await flush();
    tick(40);
    expect(onError).toHaveBeenCalledOnce();
    expect(world.map.id).toBe('a');
    // The message after the transfer is shown, not skipped by a second continue().
    expect(world.interpreter?.pending).toMatchObject({ type: 'message', text: 'after' });
  });

  it('reports an out-of-bounds target and keeps the event going', async () => {
    const { world, load, onError, tick } = setup([
      { type: 'transfer', map: 'b', x: 9, y: 9 },
      { type: 'message', text: 'after' },
    ]);
    tick();
    load.resolve({ map: map('b', 5, 5), tileset });
    await flush();
    tick(40);
    expect(onError).toHaveBeenCalledOnce();
    expect(world.map.id).toBe('a');
    expect(world.interpreter?.pending).toMatchObject({ type: 'message', text: 'after' });
  });

  it('ignores worlds with no transfer pending', () => {
    const world = new World({ manifest, map: map('a', 3, 3), tileset });
    const loadMap = vi.fn();
    const transfer = new TransferController(loadMap);
    transfer.update(DT, world);
    expect(loadMap).not.toHaveBeenCalled();
    expect(transfer.isActive).toBe(false);
  });
});
