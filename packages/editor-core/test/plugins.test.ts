import { describe, expect, it } from 'vitest';
import type { Manifest, PluginDeclaration } from '@freequest/schema';
import {
  type MemoryFs,
  ProjectDocument,
  assetReferences,
  openProject,
  planExport,
  referencesTo,
  renameId,
} from '../src/index.js';
import { demoWithoutPlugins } from './helpers.js';

const weather: PluginDeclaration = {
  formatVersion: 1,
  id: 'weather',
  name: 'Weather',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'main.js',
  settings: [
    { name: 'gate', label: 'Only while', type: 'reference', kind: 'switch', optional: true },
    { name: 'drop', label: 'Drop image', type: 'asset', optional: true },
  ],
  commands: [
    {
      id: 'rain',
      label: 'Start rain',
      params: [
        { name: 'until', label: 'Until', type: 'reference', kind: 'switch' },
        { name: 'sound', label: 'Sound', type: 'asset', optional: true },
        // Named like a field the index would otherwise guess from: it's a plain string here.
        { name: 'map', label: 'Note', type: 'string' },
      ],
    },
  ],
};

/** The demo with the weather plugin listed and a common event using its command. */
async function withPlugin(
  options: { enabled?: boolean; script?: boolean } = {},
): Promise<MemoryFs> {
  const fs = await demoWithoutPlugins();
  await fs.writeText('plugins/weather/plugin.json', JSON.stringify(weather));
  if (options.script !== false) await fs.writeText('plugins/weather/main.js', 'export default {}');
  await fs.writeBytes('plugins/weather/drop.png', new Uint8Array([1]));
  const manifest = JSON.parse(await fs.readText('project.json')) as Manifest;
  manifest.plugins = [
    {
      id: 'weather',
      path: 'plugins/weather/plugin.json',
      enabled: options.enabled ?? true,
      settings: { gate: 'rewarded', drop: 'assets/pictures/meadow-map.png' },
    },
  ];
  await fs.writeText('project.json', JSON.stringify(manifest));
  const path = 'data/database/commonEvents.json';
  const commons = JSON.parse(await fs.readText(path)) as {
    entries: { commands: unknown[] }[];
  };
  commons.entries[0]?.commands.push({
    type: 'plugin',
    plugin: 'weather',
    command: 'rain',
    args: { until: 'accepted_request', sound: 'assets/audio/sfx-heal.wav', map: 'house' },
  });
  await fs.writeText(path, JSON.stringify(commons));
  return fs;
}

describe('projects with plugins', () => {
  it('open with each plugin’s declaration and no problems', async () => {
    const project = await openProject(await withPlugin());
    expect(project.plugins.get('weather')?.data?.name).toBe('Weather');
    expect(project.problems).toEqual([]);
  });

  it('report a plugin whose script is missing', async () => {
    const project = await openProject(await withPlugin({ script: false }));
    expect(project.problems).toEqual([
      {
        source: 'plugins/weather/plugin.json',
        message: "its script main.js isn't in plugins/weather/",
      },
    ]);
  });

  it('index plugin uses and the ids their values name, by declared type', async () => {
    const project = await openProject(await withPlugin());
    expect(referencesTo(project, 'plugin', 'weather')).toHaveLength(1);
    const switches = referencesTo(project, 'switch', 'accepted_request').map((r) => r.path);
    expect(switches).toContainEqual([
      'entries',
      0,
      'commands',
      expect.any(Number),
      'args',
      'until',
    ]);
    expect(referencesTo(project, 'switch', 'rewarded')).toContainEqual(
      expect.objectContaining({
        file: 'project.json',
        path: ['plugins', 0, 'settings', 'gate'],
        where: 'Project settings › Plugins › Weather',
      }),
    );
    // "map" is a plugin's own string parameter here, not a map reference.
    expect(referencesTo(project, 'map', 'house').filter((r) => r.path.includes('args'))).toEqual(
      [],
    );
  });

  it('renames ids inside plugin values', async () => {
    const doc = new ProjectDocument(await openProject(await withPlugin()));
    renameId(doc, 'switch', 'rewarded', 'paid');
    renameId(doc, 'switch', 'accepted_request', 'agreed');
    expect(doc.project.manifest.data.plugins?.[0]?.settings?.['gate']).toBe('paid');
    const commands = doc.project.database.commonEvents?.data?.entries[0]?.commands ?? [];
    expect(commands.at(-1)).toMatchObject({ args: { until: 'agreed' } });
    expect(doc.project.problems).toEqual([]);
  });

  it('export an enabled plugin’s folder and the files its values name', async () => {
    const fs = await withPlugin();
    const project = await openProject(fs);
    const assets = assetReferences(project);
    expect(assets.get('assets/audio/sfx-heal.wav')?.kind).toBe('audio');
    expect(assets.get('assets/pictures/meadow-map.png')?.usedBy).toContain('plugin Weather');
    const plan = await planExport(project, fs);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    const paths = plan.files.map((f) => f.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        'plugins/weather/plugin.json',
        'plugins/weather/main.js',
        'plugins/weather/drop.png',
      ]),
    );
    expect(paths.filter((p) => p === 'plugins/weather/plugin.json')).toHaveLength(1);
  });

  it('ship only the declaration of a plugin that is turned off', async () => {
    const fs = await withPlugin({ enabled: false });
    const plan = await planExport(await openProject(fs), fs);
    const paths = plan.files.map((f) => f.path).filter((p) => p.startsWith('plugins/'));
    expect(paths).toEqual(['plugins/weather/plugin.json']);
  });
});
