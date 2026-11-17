// M15 step 7: the example plugins that come with the demo and the Starter
// (weather, HUD), run for real in a World with a fake canvas.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ActionState, PluginHost, type PluginError, World } from '@freequest/core';
import { type Command, type PluginValues, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawHouse from '../../../samples/demo-project/data/maps/house.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { PluginDrawing } from '../src/plugin-drawing.js';
import { demoDb } from './demo.js';

const PLUGINS = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project', 'plugins');
const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const house = parseProjectFile('map', rawHouse);
const tileset = parseProjectFile('tileset', rawTileset);

/** A 2D context that counts what was drawn and keeps the text. */
function fakeContext() {
  const drawn = { rects: 0, lines: 0, text: [] as string[] };
  const context = {
    save() {},
    restore() {},
    beginPath() {},
    moveTo() {},
    stroke() {},
    strokeRect() {},
    lineTo: () => void drawn.lines++,
    fillRect: () => void drawn.rects++,
    fillText: (text: string) => void drawn.text.push(text),
    measureText: (text: string) => ({ width: text.length * 5 }),
  } as unknown as CanvasRenderingContext2D;
  return { drawn, context };
}

async function setUp(id: string, settings: PluginValues = {}, world?: World) {
  const declaration = parseProjectFile(
    'plugin',
    JSON.parse(readFileSync(join(PLUGINS, id, 'plugin.json'), 'utf8')) as unknown,
  );
  const module = (await import(join(PLUGINS, id, 'main.js'))) as { default: unknown };
  const drawing = new PluginDrawing();
  const errors: PluginError[] = [];
  const host = new PluginHost(
    [{ declaration, module: module.default, settings }],
    (e) => errors.push(e),
    drawing.extension,
  );
  drawing.seal();
  const game = world ?? new World({ manifest, map, tileset, database: demoDb() });
  host.start(game);
  let seconds = 0;
  const draw = () => {
    const { drawn, context } = fakeContext();
    drawing.draw(host, game, id, context, {
      width: 480,
      height: 352,
      camera: { x: 0, y: 0 },
      tileWidth: 32,
      tileHeight: 32,
      seconds: (seconds += 1 / 60),
    });
    return drawn;
  };
  const steps = (n: number) => {
    for (let i = 0; i < n; i++) game.step(1 / 60, new ActionState());
  };
  const run = (command: string, args: PluginValues = {}) => {
    const commands: Command[] = [{ type: 'plugin', plugin: id, command, args }];
    game.run(commands, null);
    steps(1);
  };
  return { host, world: game, errors, draw, steps, run };
}

describe('the weather plugin', () => {
  it('rains on the map it started on, and only there', async () => {
    const { world, errors, draw, run } = await setUp('weather');
    expect(draw().lines).toBe(0);
    run('start', { kind: 'rain', strength: 1, seconds: 0 });
    // Density 5 × 24 drops at full strength.
    expect(draw().lines).toBe(120);
    world.changeMap(house, tileset, 1, 1);
    expect(draw()).toEqual({ rects: 0, lines: 0, text: [] });
    world.changeMap(map, tileset, 5, 5);
    expect(draw().lines).toBe(120);
    expect(errors).toEqual([]);
  });

  it('fades in and out over its seconds, and snows', async () => {
    const { draw, run, steps } = await setUp('weather', { density: 2 });
    run('start', { kind: 'snow', strength: 1, seconds: 1 });
    steps(29);
    const half = draw().rects - 1;
    expect(half).toBeGreaterThan(18);
    expect(half).toBeLessThan(30);
    steps(40);
    expect(draw().rects - 1).toBe(48);
    run('stop', { seconds: 1 });
    steps(70);
    expect(draw().rects).toBe(0);
  });

  it('is kept in saves and back at full strength after loading', async () => {
    const first = await setUp('weather');
    first.run('start', { kind: 'rain', strength: 0.5, seconds: 2 });
    const save = first.world.toSave({ game: 'g', playSeconds: 1 });
    expect(save.plugins).toEqual({ weather: { map: 'map001', kind: 'rain', strength: 0.5 } });
    const loaded = World.fromSave(save, { manifest, map, tileset, database: demoDb() });
    const second = await setUp('weather', {}, loaded);
    expect(second.draw().lines).toBe(60);
  });
});

describe('the HUD plugin', () => {
  it('shows the gold by default, in its corner', async () => {
    const { world, draw, errors } = await setUp('hud');
    expect(draw().text).toEqual([`Gold ${world.party.gold}`]);
    expect(errors).toEqual([]);
  });

  it('shows a variable, only while its switch is on', async () => {
    const { world, draw } = await setUp('hud', {
      what: 'variable',
      variable: 'bridge_visits',
      label: 'Visits',
      onlyWhile: 'rewarded',
    });
    expect(draw().text).toEqual([]);
    world.state.setSwitch('rewarded', true);
    world.state.setVariable('bridge_visits', 3);
    expect(draw().text).toEqual(['Visits 3']);
  });

  it('hides and shows by command, kept in saves', async () => {
    const { world, draw, run } = await setUp('hud');
    run('hide');
    expect(draw().text).toEqual([]);
    const loaded = World.fromSave(world.toSave({ game: 'g', playSeconds: 1 }), {
      manifest,
      map,
      tileset,
      database: demoDb(),
    });
    const again = await setUp('hud', {}, loaded);
    expect(again.draw().text).toEqual([]);
    again.run('show');
    expect(again.draw().text).toHaveLength(1);
  });
});
