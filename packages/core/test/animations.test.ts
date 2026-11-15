// Animations and balloons on characters: timing, frames, sounds, waiting, and battle hits.
import { type AnimationEntry, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import {
  ActionState,
  CharacterEffects,
  World,
  animationFrame,
  animationSounds,
  balloonFrame,
  balloonSeconds,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const tileset = parseProjectFile('tileset', rawTileset);
const world = () => new World({ manifest, map, tileset, database: demoDb() });

const entry: AnimationEntry = {
  id: 'boom',
  name: 'Boom',
  frameWidth: 32,
  frameHeight: 32,
  frames: 10,
  fps: 10,
  sounds: [
    { frame: 0, path: 'a.wav' },
    { frame: 5, path: 'b.wav' },
  ],
};

function steps(w: World, n: number) {
  const input = new ActionState();
  for (let i = 0; i < n; i++) w.step(1 / 60, input);
}

describe('animation timing', () => {
  it('shows frames at its speed, and its sounds as their frames come', () => {
    expect(animationFrame(entry, 0)).toBe(0);
    expect(animationFrame(entry, 0.55)).toBe(5);
    expect(animationFrame(entry, 5)).toBe(9);
    expect(animationSounds(entry, 0, 0.1)).toEqual(['a.wav']);
    expect(animationSounds(entry, 0.1, 0.49)).toEqual([]);
    expect(animationSounds(entry, 0.49, 0.51)).toEqual(['b.wav']);
  });

  it('balloons pop up, then stay a moment on their last frame', () => {
    expect(balloonSeconds(6)).toBeCloseTo(0.5 + 0.6);
    expect(balloonFrame(6, 0)).toBe(0);
    expect(balloonFrame(6, 1)).toBe(5);
  });

  it('plays sounds once each, finishes, and a new balloon replaces the old one', () => {
    const effects = new CharacterEffects();
    const heard: string[] = [];
    const done = effects.play(entry, 'player');
    for (let i = 0; i < 70; i++) effects.update(1 / 60, (p) => heard.push(p));
    expect(heard).toEqual(['a.wav', 'b.wav']);
    expect(done()).toBe(true);
    expect(effects.animations).toEqual([]);
    const first = effects.balloon(0, 6, 'elder');
    const second = effects.balloon(1, 6, 'elder');
    expect(first()).toBe(true);
    expect(second()).toBe(false);
    expect(effects.balloons).toMatchObject([{ balloon: 1, target: 'elder' }]);
  });
});

describe('in the world', () => {
  it('plays an animation on the player, waits for it, and its sounds reach the world', () => {
    const w = world();
    const interpreter = w.run([
      { type: 'showAnimation', target: 'player', animation: 'sparkle', wait: true },
      { type: 'setSwitch', switch: 'rewarded', value: true },
    ]);
    steps(w, 2);
    expect(w.effects.animations).toMatchObject([{ target: 'player' }]);
    expect(w.drainSounds()).toEqual(['assets/audio/sfx-heal.wav']);
    expect(w.state.getSwitch('rewarded')).toBe(false);
    // 8 frames at 12 per second: two thirds of a second.
    steps(w, 42);
    expect(w.interpreter).toBeNull();
    expect(interpreter.isDone).toBe(true);
    expect(w.state.getSwitch('rewarded')).toBe(true);
  });

  it('shows a balloon over "this" event, and a map change clears everything', () => {
    const w = world();
    const elder = w.events.find((e) => e.id === 'elder') ?? null;
    w.run([{ type: 'showBalloon', target: 'this', balloon: 3, wait: false }], elder);
    steps(w, 1);
    expect(w.effects.balloons).toMatchObject([{ target: 'elder', balloon: 3 }]);
    w.changeMap(map, tileset, 7, 7);
    expect(w.effects.balloons).toEqual([]);
  });

  it('finishes at once for a character or animation that isn’t there', () => {
    const w = world();
    w.run([{ type: 'showAnimation', target: 'nobody', animation: 'sparkle', wait: true }]);
    steps(w, 1);
    expect(w.interpreter).toBeNull();
  });
});
