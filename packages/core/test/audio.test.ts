import { describe, expect, it } from 'vitest';
import { ActionState, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;

function setup(music?: string) {
  const map = { ...makeMap(['...']), ...(music ? { music } : {}) };
  const world = new World({ manifest: makeManifest(), map, tileset });
  const run = (commands: Parameters<World['run']>[0]) => {
    world.run(commands);
    world.step(DT, new ActionState());
  };
  return { world, map, run };
}

describe('audio from the world', () => {
  it("plays the map's music", () => {
    expect(setup('audio/meadow.wav').world.music).toBe('audio/meadow.wav');
    expect(setup().world.music).toBeNull();
  });

  it('lets events change or stop the music until the next map change', () => {
    const { world, map, run } = setup('audio/meadow.wav');
    run([{ type: 'playMusic', path: 'audio/boss.wav' }]);
    expect(world.music).toBe('audio/boss.wav');
    run([{ type: 'playMusic', path: null }]);
    expect(world.music).toBeNull();
    world.changeMap(map, tileset, 0, 0);
    expect(world.music).toBe('audio/meadow.wav');
  });

  it('queues sounds for the runtime, handing each over once', () => {
    const { world, run } = setup();
    run([
      { type: 'playSound', path: 'audio/door.wav' },
      { type: 'playSound', path: 'audio/chime.wav' },
    ]);
    expect(world.drainSounds()).toEqual(['audio/door.wav', 'audio/chime.wav']);
    expect(world.drainSounds()).toEqual([]);
  });
});
