import { PluginHost, type PluginError, World } from '@freequest/core';
import { type PluginDeclaration, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { type GamePluginApi, type PluginFrame, PluginDrawing } from '../src/plugin-drawing.js';
import { demoDb } from './demo.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const tileset = parseProjectFile('tileset', rawTileset);

const declaration = (id: string): PluginDeclaration => ({
  formatVersion: 1,
  id,
  name: id,
  version: '1',
  apiVersion: 1,
  entry: 'main.js',
  settings: [],
  commands: [],
});

/** A stand-in 2D context that records save/restore and fills. */
function fakeContext() {
  const calls: string[] = [];
  return {
    calls,
    context: {
      save: () => calls.push('save'),
      restore: () => calls.push('restore'),
      fillRect: (x: number, y: number) => calls.push(`fill ${x},${y}`),
    } as unknown as CanvasRenderingContext2D,
  };
}

const base = {
  width: 320,
  height: 240,
  camera: { x: 16, y: 32 },
  tileWidth: 16,
  tileHeight: 16,
  seconds: 2,
};

function setUp(setups: Record<string, (api: GamePluginApi) => void>) {
  const drawing = new PluginDrawing();
  const errors: PluginError[] = [];
  const host = new PluginHost(
    Object.entries(setups).map(([id, setup]) => ({
      declaration: declaration(id),
      module: { setup },
    })),
    (e) => errors.push(e),
    drawing.extension,
  );
  drawing.seal();
  const world = new World({ manifest, map, tileset, database: demoDb() });
  host.start(world);
  return { drawing, host, world, errors };
}

describe('plugin drawing', () => {
  it('lists drawing plugins in order and gives each its frame', () => {
    const frames: PluginFrame[] = [];
    const { drawing, host, world } = setUp({
      quiet: () => undefined,
      rain: (api) =>
        api.onDraw((frame) => {
          frames.push(frame);
          frame.context.fillRect(10 - frame.camera.x, 40 - frame.camera.y, 1, 1);
        }),
      clock: (api) => api.onDraw(() => undefined),
    });
    expect(drawing.plugins).toEqual(['rain', 'clock']);
    const { context, calls } = fakeContext();
    expect(drawing.draw(host, world, 'rain', context, base)).toBe(true);
    expect(calls).toEqual(['save', 'fill -6,8', 'restore']);
    expect(frames[0]).toMatchObject({ ...base, context });
    expect(frames[0]?.game.map.id).toBe('map001');
  });

  it('switches off a plugin whose drawing throws, and refuses hooks after setup', () => {
    let api: GamePluginApi | null = null;
    const { drawing, host, world, errors } = setUp({
      rain: (a) => {
        api = a;
        a.onDraw(() => {
          throw new Error('no canvas for you');
        });
      },
    });
    const { context, calls } = fakeContext();
    expect(drawing.draw(host, world, 'rain', context, base)).toBe(false);
    expect(calls).toEqual(['save', 'restore']);
    expect(errors.map((e) => e.message)).toEqual([
      'Plugin "rain" stopped working (draw): no canvas for you',
    ]);
    expect(drawing.draw(host, world, 'rain', context, base)).toBe(false);
    expect(() => (api as GamePluginApi | null)?.onDraw(() => undefined)).toThrow(/only.*setup/);
  });
});
