import { describe, expect, it } from 'vitest';
import {
  MANIFEST_FORMAT_VERSION,
  MAP_FORMAT_VERSION,
  SAVE_FORMAT_VERSION,
  type Manifest,
  PLUGIN_API_VERSION,
  type PluginDeclaration,
  type PluginParam,
  ProjectFileError,
  checkManifestReferences,
  checkMapReferences,
  checkPluginShape,
  checkPluginValues,
  emptyDatabase,
  migrate,
  parseProjectFile,
  pluginFolder,
  pluginParamDefault,
  pluginPath,
  resolvePluginValues,
  type GameMap,
  type Command,
} from '../src/index.js';

const weather: PluginDeclaration = {
  formatVersion: 1,
  id: 'weather',
  name: 'Weather',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'main.js',
  settings: [{ name: 'density', label: 'Density', type: 'integer', min: 1, max: 10, default: 5 }],
  commands: [
    {
      id: 'rain',
      label: 'Start rain',
      params: [
        { name: 'strength', label: 'Strength', type: 'number', min: 0, max: 1 },
        {
          name: 'kind',
          label: 'Kind',
          type: 'choice',
          options: [
            { value: 'drizzle', label: 'Drizzle' },
            { value: 'storm', label: 'Storm' },
          ],
        },
        { name: 'until', label: 'Until', type: 'reference', kind: 'switch' },
        { name: 'sound', label: 'Sound', type: 'asset', folder: 'assets/audio', optional: true },
      ],
    },
  ],
};

const manifest: Manifest = {
  formatVersion: MANIFEST_FORMAT_VERSION,
  id: 'game',
  name: 'Game',
  screen: { width: 32, height: 32 },
  start: { map: 'a', x: 0, y: 0, direction: 'down', party: [], gold: 0 },
  player: { character: 'hero', speed: 4 },
  tilesets: [],
  maps: [{ id: 'a', path: 'data/maps/a.json' }],
  characters: [],
  switches: [{ id: 'dry', name: 'Dry' }],
  variables: [],
  plugins: [
    { id: 'weather', path: pluginPath('weather'), enabled: true, settings: { density: 3 } },
  ],
};

function mapWith(commands: Command[]): GameMap {
  return {
    formatVersion: 10,
    id: 'a',
    name: 'A',
    tileset: 'ts',
    width: 1,
    height: 1,
    layers: [],
    events: [
      {
        id: 'e',
        name: 'E',
        x: 0,
        y: 0,
        pages: [{ conditions: [], trigger: 'action', layer: 'below', commands }],
      },
    ],
  } as unknown as GameMap;
}

describe('plugin declarations', () => {
  it('parse, with the script inside the plugin folder', () => {
    expect(parseProjectFile('plugin', weather)).toEqual(weather);
    for (const entry of ['../evil.js', 'a/../../b.js', '/abs.js', 'main.ts', './main.js']) {
      expect(() => parseProjectFile('plugin', { ...weather, entry }), entry).toThrow(
        ProjectFileError,
      );
    }
    expect(parseProjectFile('plugin', { ...weather, entry: 'src/main.mjs' }).entry).toBe(
      'src/main.mjs',
    );
  });

  it('live at plugins/<id>/plugin.json', () => {
    expect(pluginPath('weather')).toBe('plugins/weather/plugin.json');
    expect(pluginFolder('plugins/weather/plugin.json')).toBe('plugins/weather/');
  });

  it('report a newer API, repeated names and defaults that break their own rules', () => {
    expect(checkPluginShape(weather)).toEqual([]);
    const broken: PluginDeclaration = {
      ...weather,
      apiVersion: PLUGIN_API_VERSION + 1,
      settings: [
        { name: 'a', label: 'A', type: 'boolean' },
        { name: 'a', label: 'A again', type: 'boolean' },
        { name: 'n', label: 'N', type: 'integer', min: 5, max: 1 },
        { name: 'm', label: 'M', type: 'integer', max: 3, default: 9 },
        {
          name: 'c',
          label: 'C',
          type: 'choice',
          options: [
            { value: 'x', label: 'X' },
            { value: 'x', label: 'X' },
          ],
          default: 'y',
        },
      ],
      commands: [...weather.commands, ...weather.commands],
    };
    const problems = checkPluginShape(broken);
    expect(problems).toEqual([
      expect.stringContaining(`needs plugin API ${PLUGIN_API_VERSION + 1}`),
      'settings: "a" is declared twice',
      'settings n: min 5 is above max 1',
      'settings default of m: 9 is above the highest, 3',
      'settings c: choice "x" is declared twice',
      'settings default of c: "y" isn\'t one of its choices',
      'command "rain" is declared twice',
    ]);
  });
});

describe('plugin values', () => {
  const params = weather.commands[0]?.params ?? [];

  it('fill in defaults by type', () => {
    const p = (param: Partial<PluginParam> & Pick<PluginParam, 'type'>) =>
      pluginParamDefault({ name: 'x', label: 'X', ...param } as PluginParam);
    expect(p({ type: 'boolean' })).toBe(false);
    expect(p({ type: 'integer', min: 2 })).toBe(2);
    expect(p({ type: 'number', max: -1 })).toBe(-1);
    expect(p({ type: 'string' })).toBe('');
    expect(p({ type: 'color' })).toBe('#ffffff');
    expect(resolvePluginValues(params, { strength: 0.5 })).toEqual({
      strength: 0.5,
      kind: 'drizzle',
      until: '',
      sound: '',
    });
  });

  it('are checked against their declarations', () => {
    const exists = (kind: string, id: string) => kind === 'switch' && id === 'dry';
    expect(checkPluginValues('rain', params, { until: 'dry' }, exists)).toEqual([]);
    expect(
      checkPluginValues(
        'rain',
        params,
        { strength: 2, kind: 'hail', until: 'wet', sound: 'x.wav', speed: 1 },
        exists,
      ),
    ).toEqual([
      'rain: no parameter "speed"',
      'rain strength: 2 is above the highest, 1',
      'rain kind: "hail" isn\'t one of its choices',
      'rain until: unknown switch "wet"',
      'rain sound: "x.wav" isn\'t a file under assets/',
    ]);
    expect(checkPluginValues('rain', params, { strength: 'lots' })).toEqual([
      'rain strength: should be a number',
      'rain until: needs a value',
    ]);
  });
});

describe('plugin references', () => {
  const plugins = new Map([['weather', weather]]);
  const ctx = { manifest, tilesets: new Map(), characters: new Map(), plugins };

  it('check the manifest’s plugins: place, duplicates and settings', () => {
    expect(checkManifestReferences(ctx)).not.toContainEqual(expect.stringContaining('plugin'));
    const bad: Manifest = {
      ...manifest,
      plugins: [
        { id: 'weather', path: 'plugins/other/plugin.json', enabled: true, settings: { x: 1 } },
        { id: 'weather', path: pluginPath('weather'), enabled: false, settings: { density: 0 } },
      ],
    };
    expect(
      checkManifestReferences({ ...ctx, manifest: bad }).filter((p) => p.includes('plugin')),
    ).toEqual([
      'project.json plugin "weather": should be at plugins/weather/plugin.json, not plugins/other/plugin.json',
      'project.json plugin "weather" settings: no parameter "x"',
      'project.json: duplicate plugin "weather"',
      'project.json plugin "weather" settings density: 0 is below the lowest, 1',
    ]);
  });

  it('check plugin commands: the plugin, the command and its arguments', () => {
    const map = mapWith([
      { type: 'plugin', plugin: 'weather', command: 'rain', args: { until: 'dry' } },
      { type: 'plugin', plugin: 'clock', command: 'show', args: {} },
      { type: 'plugin', plugin: 'weather', command: 'snow', args: {} },
      { type: 'plugin', plugin: 'weather', command: 'rain', args: { until: 'nope' } },
    ]);
    const db = { ...emptyDatabase() };
    expect(checkMapReferences(map, { ...ctx, database: db })).toEqual([
      'map "a": unknown tileset "ts"',
      'map "a" event "e" pages[0].commands[1]: uses plugin "clock", which the project doesn\'t have',
      'map "a" event "e" pages[0].commands[2]: plugin "weather" has no command "snow"',
      'map "a" event "e" pages[0].commands[3] (Weather: Start rain) until: unknown switch "nope"',
    ]);
    // Without declarations (the game before plugins load), only the listing is checked.
    const { plugins: _, ...bare } = ctx;
    expect(checkMapReferences(map, bare)).toEqual([
      'map "a": unknown tileset "ts"',
      'map "a" event "e" pages[0].commands[1]: uses plugin "clock", which the project doesn\'t have',
    ]);
  });

  it('come from manifest v9 and map v9 unchanged (additive)', () => {
    const { plugins: _, ...v9 } = { ...manifest, formatVersion: 9 };
    expect(migrate('manifest', v9)).toEqual({ ...v9, formatVersion: 10 });
    const map = { ...mapWith([]), formatVersion: 9 };
    expect(migrate('map', map)).toEqual({ ...map, formatVersion: MAP_FORMAT_VERSION });
  });
});

describe('plugin reference kinds', () => {
  it('list every kind the schema accepts', async () => {
    const { PLUGIN_REFERENCE_TYPES, PluginParam } = await import('../src/index.js');
    const { default: Value } = await import('typebox/value');
    for (const kind of PLUGIN_REFERENCE_TYPES) {
      expect(Value.Check(PluginParam, { name: 'x', label: 'X', type: 'reference', kind })).toBe(
        true,
      );
    }
  });
});

describe('saves with plugin data', () => {
  it('come from save v3 unchanged (additive)', () => {
    const v3 = { formatVersion: 3, game: 'g' };
    expect(migrate('save', v3)).toEqual({ formatVersion: SAVE_FORMAT_VERSION, game: 'g' });
  });
});
