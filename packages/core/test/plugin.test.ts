// M15 step 2: plugins' setup, hooks and commands, run by PluginHost in a World.
import { type Command, type PluginDeclaration, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawHouse from '../../../samples/demo-project/data/maps/house.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import {
  ActionState,
  type PluginApi,
  type PluginError,
  PluginHost,
  type PluginModule,
  World,
  definePlugin,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const house = parseProjectFile('map', rawHouse);
const tileset = parseProjectFile('tileset', rawTileset);

const declaration: PluginDeclaration = {
  formatVersion: 1,
  id: 'counter',
  name: 'Counter',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'main.js',
  settings: [{ name: 'step', label: 'Step', type: 'integer', default: 1 }],
  commands: [
    {
      id: 'add',
      label: 'Add',
      params: [
        { name: 'times', label: 'Times', type: 'integer', default: 2 },
        { name: 'until', label: 'Until', type: 'reference', kind: 'switch', optional: true },
      ],
    },
  ],
};

function setUp(module: PluginModule | unknown, settings?: Record<string, number>) {
  const errors: PluginError[] = [];
  const host = new PluginHost(
    [{ declaration, module, ...(settings ? { settings } : {}) }],
    (error) => errors.push(error),
  );
  const world = new World({ manifest, map, tileset, database: demoDb() });
  return { host, world, errors };
}

/** Run commands as an event would, stepping until they finish (or `steps` run out). */
function run(world: World, commands: readonly Command[], steps = 2000) {
  const interpreter = world.run(commands, null);
  const input = new ActionState();
  let count = 0;
  for (; count < steps && world.interpreter === interpreter; count++) world.step(1 / 60, input);
  return count;
}

const add = (args: Record<string, string | number | boolean> = {}): Command => ({
  type: 'plugin',
  plugin: 'counter',
  command: 'add',
  args,
});

describe('plugins', () => {
  it('get their settings and hooks: game start, then map loaded, steps and map changes', () => {
    const calls: string[] = [];
    let settings: PluginApi['settings'] | null = null;
    const { host, world, errors } = setUp(
      definePlugin({
        setup(api) {
          settings = api.settings;
          api.onGameStart((game) => calls.push(`start ${game.map.id}`));
          api.onMapLoaded((game) => calls.push(`map ${game.map.id} ${game.map.width}`));
          api.onStep((game, dt) => calls.push(`step ${dt.toFixed(3)} at ${game.player.x}`));
          api.command('add', () => undefined);
        },
      }),
      { step: 5 },
    );
    expect(settings).toEqual({ step: 5 });
    host.start(world);
    expect(world.plugins).toBe(host);
    world.step(1 / 60, new ActionState());
    world.changeMap(house, tileset, 1, 1);
    expect(calls).toEqual([
      'start map001',
      `map map001 ${map.width}`,
      `step 0.017 at ${manifest.start.x}`,
      `map house ${house.width}`,
    ]);
    expect(errors).toEqual([]);
  });

  it('run commands with defaults filled in, and change switches and variables', () => {
    const seen: unknown[] = [];
    const { host, world } = setUp({
      setup(api: PluginApi) {
        api.command('add', ({ args, game, event }) => {
          seen.push({ args, event });
          game.setVariable(
            'bridge_visits',
            game.getVariable('bridge_visits') + Number(args['times']),
          );
          game.setSwitch('rewarded', true);
        });
      },
    });
    host.start(world);
    run(world, [add(), add({ times: 5 })]);
    expect(seen).toEqual([
      { args: { times: 2, until: '' }, event: null },
      { args: { times: 5, until: '' }, event: null },
    ]);
    expect(world.state.getVariable('bridge_visits')).toBe(7);
    expect(world.state.getSwitch('rewarded')).toBe(true);
  });

  it('make the event wait on a returned check', () => {
    let ticks = 0;
    const { host, world } = setUp({
      setup(api: PluginApi) {
        api.command('add', () => () => ++ticks >= 10);
      },
    });
    host.start(world);
    const steps = run(world, [add()]);
    expect(ticks).toBe(10);
    expect(steps).toBeGreaterThanOrEqual(9);
  });

  it('do nothing without a host (and the event carries on)', () => {
    const world = new World({ manifest, map, tileset, database: demoDb() });
    expect(run(world, [add(), { type: 'setSwitch', switch: 'rewarded', value: true }])).toBe(1);
    expect(world.state.getSwitch('rewarded')).toBe(true);
  });

  it('that throw are reported once, switched off, and never stop the game', () => {
    let steps = 0;
    const { host, world, errors } = setUp({
      setup(api: PluginApi) {
        api.onStep(() => {
          steps++;
          if (steps === 2) throw new Error('boom');
        });
        api.command('add', () => undefined);
      },
    });
    host.start(world);
    for (let i = 0; i < 5; i++) world.step(1 / 60, new ActionState());
    expect(steps).toBe(2);
    expect(errors.map((e) => e.message)).toEqual(['Plugin "Counter" stopped working (step): boom']);
    expect(host.status).toEqual([
      { id: 'counter', name: 'Counter', version: '1.0.0', working: false },
    ]);
    // Its commands now do nothing, and events go on.
    expect(run(world, [add()])).toBe(1);
  });

  it('report a failing command, a bad result and a failing wait check', () => {
    for (const handler of [
      () => {
        throw new Error('no');
      },
      () => 42,
      () => () => {
        throw new Error('check');
      },
    ]) {
      const { host, world, errors } = setUp({
        setup(api: PluginApi) {
          api.command('add', handler as never);
        },
      });
      host.start(world);
      run(world, [add()]);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.hook).toBe('command "add"');
    }
  });

  it('report scripts without setup, setup errors and undeclared or missing commands', () => {
    const messages = (module: unknown) => setUp(module).errors.map((e) => e.message);
    expect(messages({})).toEqual([
      'Plugin "Counter" stopped working (load): its script must export default { setup(api) { … } }',
    ]);
    expect(
      messages({
        setup() {
          throw new Error('bad');
        },
      }),
    ).toEqual(['Plugin "Counter" stopped working (setup): bad']);
    expect(
      messages({
        setup(api: PluginApi) {
          api.command('sub', () => undefined);
        },
      }),
    ).toEqual([
      'Plugin "Counter" stopped working (setup): command "sub" isn\'t declared in plugin.json',
    ]);
    expect(messages({ setup() {} })).toEqual([
      'Plugin "Counter" stopped working (setup): plugin.json declares "add", but setup didn\'t register it with api.command',
    ]);
  });

  it('can’t register hooks after setup', () => {
    let later: PluginApi | null = null;
    const { host, world, errors } = setUp({
      setup(api: PluginApi) {
        later = api;
        api.command('add', () => undefined);
        api.onMapLoaded(() => later?.onStep(() => undefined));
      },
    });
    host.start(world);
    expect(errors.map((e) => e.message)).toEqual([
      'Plugin "Counter" stopped working (map loaded): onStep can only be registered in setup',
    ]);
  });
});

describe('plugin data', () => {
  const keeper = (log: unknown[]) => ({
    setup(api: PluginApi) {
      api.onGameStart((game) => log.push(game.getData()));
      api.command('add', ({ game }) => {
        const data = (game.getData() as { count: number } | undefined) ?? { count: 0 };
        data.count++;
        game.setData(data);
      });
    },
  });

  it('starts empty, is kept in saves and comes back on load', () => {
    const log: unknown[] = [];
    const { host, world } = setUp(keeper(log));
    host.start(world);
    run(world, [add(), add()]);
    const save = world.toSave({ game: 'g', playSeconds: 1 });
    expect(save.plugins).toEqual({ counter: { count: 2 } });
    const loaded = World.fromSave(save, { manifest, map, tileset, database: demoDb() });
    host.start(loaded);
    expect(log).toEqual([undefined, { count: 2 }]);
    run(loaded, [add()]);
    expect(loaded.pluginData.get('counter')).toEqual({ count: 3 });
    // The first game is untouched.
    expect(world.pluginData.get('counter')).toEqual({ count: 2 });
  });

  it('is copied in and out, and only plain JSON of a sensible size is stored', () => {
    const outcomes: string[] = [];
    const { host, world, errors } = setUp({
      setup(api: PluginApi) {
        api.command('add', ({ game }) => {
          const value = { list: [1, 2] };
          game.setData(value);
          value.list.push(3);
          const read = game.getData() as { list: number[] };
          read.list.push(4);
          outcomes.push(JSON.stringify(game.getData()));
          for (const bad of [new Map(), { when: new Date() }, Number.NaN, 'x'.repeat(200_000)]) {
            try {
              game.setData(bad);
              outcomes.push('stored');
            } catch (e) {
              outcomes.push((e as Error).message.split(' (')[0] ?? '');
            }
          }
          game.setData(undefined);
          outcomes.push(String(game.getData()));
        });
      },
    });
    host.start(world);
    run(world, [add()]);
    expect(errors).toEqual([]);
    expect(outcomes).toEqual([
      '{"list":[1,2]}',
      'setData needs plain JSON data',
      'setData needs plain JSON data',
      'setData needs plain JSON data',
      'setData: data is 200002 characters, more than 100000',
      'undefined',
    ]);
    expect(world.toSave({ game: 'g', playSeconds: 0 }).plugins).toBeUndefined();
  });
});
