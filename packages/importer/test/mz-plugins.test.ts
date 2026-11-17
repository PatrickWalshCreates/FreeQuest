// M15 step 6: the MZ plugins a game used, and their commands, in the import report.
// The plugin names here are made up; js/plugins.js is read as data, never run.
import { MemoryFs, openProject } from '@freequest/editor-core';
import { describe, expect, it } from 'vitest';
import { ImportReport, importMzProject, readMzPlugins } from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

const PLUGINS_JS = `// A comment, as MZ writes one.
var $plugins =
[
{"name":"FancyWeather","status":true,"description":"Rain","parameters":{"drops":"40"}},
{"name":"OldMenu","status":false,"description":"","parameters":{}},
{"name":"BattleHud","status":true,"description":"","parameters":{}}
];
`;

async function importWith(files: Record<string, string>) {
  const source = await memoryCopy(TINY);
  for (const [path, text] of Object.entries(files)) await source.writeText(path, text);
  const target = new MemoryFs();
  const { report } = await importMzProject(source, target, {
    template: await starter(),
    images: codec,
  });
  return { report, target };
}

describe('MZ plugins', () => {
  it('are read from js/plugins.js as data, with their on/off state', async () => {
    const fs = new MemoryFs();
    const report = new ImportReport();
    expect(await readMzPlugins(fs, report)).toBeNull();
    await fs.writeText('js/plugins.js', PLUGINS_JS);
    expect(await readMzPlugins(fs, report)).toEqual([
      { name: 'FancyWeather', on: true },
      { name: 'OldMenu', on: false },
      { name: 'BattleHud', on: true },
    ]);
    await fs.writeText('js/plugins.js', 'var $plugins = [ { broken');
    expect(await readMzPlugins(fs, report)).toEqual([]);
    expect(report.items.map((i) => i.message)).toEqual([
      "js/plugins.js couldn't be read, so the plugins the game used aren't listed.",
    ]);
  });

  it('are listed in the report, and their commands become comments grouped by plugin', async () => {
    const commons = JSON.parse(
      await (await memoryCopy(TINY)).readText('data/CommonEvents.json'),
    ) as {
      list: unknown[];
    }[];
    const first = commons[1];
    if (!first) throw new Error('fixture changed');
    first.list = [
      {
        code: 357,
        indent: 0,
        parameters: ['FancyWeather', 'start', 'Start rain', { power: '5', fog: 'true' }],
      },
      { code: 657, indent: 0, parameters: ['Power = 5'] },
      { code: 357, indent: 0, parameters: ['FancyWeather', 'stop', '', {}] },
      { code: 356, indent: 0, parameters: ['ShowHud on'] },
      { code: 0, indent: 0, parameters: [] },
    ];
    const { report, target } = await importWith({
      'js/plugins.js': PLUGINS_JS,
      'data/CommonEvents.json': JSON.stringify(commons),
    });
    const plugins = report.items.filter((i) => i.where === 'Plugins');
    expect(plugins.map((i) => i.message)).toEqual([
      'The game used 2 MZ plugins: FancyWeather, BattleHud. Turned off: OldMenu. ' +
        "FreeQuest doesn't run MZ plugins (JavaScript written for RPG Maker). Their commands are comments in the events, listed as “Plugin command (name)”; a FreeQuest plugin can do what one did.",
    ]);
    const common = JSON.parse(await target.readText('data/database/commonEvents.json')) as {
      entries: { id: string; commands: unknown[] }[];
    };
    expect(common.entries.find((e) => e.id === 'open-gate')?.commands).toEqual([
      {
        type: 'comment',
        text: 'From MZ, not imported: plugin FancyWeather command: Start rain (power=5, fog=true)',
      },
      { type: 'comment', text: 'From MZ, not imported: plugin FancyWeather command: stop' },
      { type: 'comment', text: 'From MZ, not imported: plugin command: ShowHud on' },
    ]);
    expect(report.summary()).toEqual(
      expect.arrayContaining([
        { level: 'missing', name: 'Plugin command (FancyWeather)', count: 2, places: 1 },
        { level: 'missing', name: 'Plugin command (one-line, MV style)', count: 1, places: 1 },
        { level: 'missing', name: 'MZ plugins (turned on)', count: 2, places: 1 },
      ]),
    );
    expect((await openProject(target)).problems).toEqual([]);
  });
});
