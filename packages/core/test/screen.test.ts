// Screen effects (fade, tint, flash, shake) and hiding events.
import type { Command, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, FLASH_START, ScreenEffects, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;

function setup(events: MapEvent[] = []) {
  const map = makeMap(['.....', '.....', '.....']);
  map.events = events;
  const manifest = makeManifest({ x: 2, y: 1, direction: 'right' });
  const world = new World({ manifest, map, tileset });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.step(DT, input);
      input.endStep();
    }
  };
  return { world, map, manifest, input, tick };
}

describe('ScreenEffects', () => {
  it('fades out and back in over time', () => {
    const screen = new ScreenEffects();
    const done = screen.fadeTo('out', 1);
    screen.update(0.5);
    expect(screen.fade).toBeCloseTo(0.5);
    expect(done()).toBe(false);
    screen.update(0.5);
    expect([screen.fade, done()]).toEqual([1, true]);
    screen.fadeTo('in', 0);
    expect(screen.fade).toBe(0);
  });

  it('tints towards a colour, and blends one tint into the next', () => {
    const screen = new ScreenEffects();
    screen.tintTo('#ff0000', 0.6, 1);
    screen.update(0.5);
    expect(screen.tint).toEqual({ color: '#ff0000', strength: expect.closeTo(0.3) });
    screen.update(0.5);
    screen.tintTo('#0000ff', 0.6, 1);
    screen.update(0.5);
    expect(screen.tint.color).toBe('#800080');
    screen.update(0.5);
    expect(screen.tint).toEqual({ color: '#0000ff', strength: 0.6 });
  });

  it('flashes and fades away, and shakes then stops', () => {
    const screen = new ScreenEffects();
    screen.flashOnce('#ffffff', 1);
    expect(screen.flash.alpha).toBe(FLASH_START);
    screen.shake(8, 1);
    const offsets = new Set<number>();
    for (let i = 0; i < 30; i++) {
      screen.update(1 / 30);
      offsets.add(screen.shakeX);
    }
    expect(Math.max(...offsets)).toBeGreaterThan(2);
    expect(Math.min(...offsets)).toBeLessThan(-2);
    expect(screen.flash.alpha).toBe(0);
    expect(screen.shakeX).toBe(0);
  });

  it('keeps the fade and tint in saves', () => {
    const screen = new ScreenEffects();
    screen.tintTo('#203060', 0.4, 0);
    screen.fadeTo('out', 0);
    const copy = new ScreenEffects();
    copy.loadData(screen.toData());
    expect(copy.toData()).toEqual({ fade: 1, tint: { color: '#203060', strength: 0.4 } });
    copy.loadData(undefined);
    expect(copy.toData()).toEqual({ fade: 0, tint: { color: '#000000', strength: 0 } });
  });
});

describe('screen commands', () => {
  it('waits for an effect when asked, and goes on at once otherwise', () => {
    const { world, tick } = setup();
    const fade: Command = { type: 'fadeScreen', to: 'out', seconds: 0.5, wait: true };
    const shake: Command = { type: 'shakeScreen', power: 4, seconds: 2, wait: false };
    world.run([fade, shake, { type: 'message', text: 'dark' }]);
    tick(15);
    expect(world.interpreter?.pending).toBeNull();
    tick(16);
    expect(world.screen.fade).toBe(1);
    expect(world.interpreter?.pending).toMatchObject({ text: 'dark' });
  });

  it('keeps a tint across map changes and in saves', () => {
    const { world, map, manifest, tick } = setup();
    world.run([{ type: 'tintScreen', color: '#102040', strength: 0.5, seconds: 0, wait: false }]);
    tick();
    world.changeMap({ ...map, id: 'other' }, tileset, 0, 0);
    world.changeMap(map, tileset, 2, 1);
    const save = world.toSave({ game: 'g', playSeconds: 0 });
    expect(save.screen).toEqual({ fade: 0, tint: { color: '#102040', strength: 0.5 } });
    const loaded = World.fromSave(save, { manifest, map, tileset, database: world.db });
    expect(loaded.screen.tint).toEqual({ color: '#102040', strength: 0.5 });
  });

  it('hides an event until the map loads again, or until shown', () => {
    const statue: MapEvent = {
      id: 'statue',
      name: 'Statue',
      x: 3,
      y: 1,
      pages: [{ conditions: [], trigger: 'action', layer: 'same', commands: [] }],
    };
    const { world, map, tick } = setup([statue]);
    const event = () => world.events.find((e) => e.id === 'statue');
    world.run([{ type: 'hideEvent', hidden: true, event: 'statue' }]);
    tick();
    expect(event()?.page).toBeNull();
    expect(world.passability.isPassable(3, 1)).toBe(true);
    world.run([{ type: 'hideEvent', hidden: false, event: 'statue' }]);
    tick();
    expect(event()?.page).not.toBeNull();
    world.run([{ type: 'hideEvent', hidden: true, event: 'statue' }]);
    tick();
    world.changeMap(map, tileset, 2, 1);
    expect(event()?.page).not.toBeNull();
  });
});
