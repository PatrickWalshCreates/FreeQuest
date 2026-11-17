// M15 step 5: adding, ordering, configuring and removing plugins in the editor.
import type { PluginDeclaration } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  MANIFEST_PATH,
  type PluginSourceFile,
  ProjectDocument,
  addPlugin,
  encodeUtf8,
  movePlugin,
  openProject,
  pluginSourceFiles,
  readPluginFolder,
  removePlugin,
  setPluginEnabled,
  setPluginSetting,
  MemoryFs,
} from '../src/index.js';
import { demoWithoutPlugins } from './helpers.js';

const declaration = (id: string): PluginDeclaration => ({
  formatVersion: 1,
  id,
  name: `The ${id}`,
  version: '1.2.0',
  apiVersion: 1,
  entry: 'src/main.js',
  settings: [{ name: 'speed', label: 'Speed', type: 'integer', min: 1, max: 9, default: 3 }],
  commands: [{ id: 'go', label: 'Go', params: [] }],
});

const folder = (id: string, extra: Record<string, string> = {}): PluginSourceFile[] =>
  Object.entries({
    'plugin.json': JSON.stringify(declaration(id)),
    'src/main.js': 'export default { setup(api) { api.command("go", () => {}); } }',
    'drop.png': 'png',
    '.DS_Store': 'junk',
    ...extra,
  }).map(([path, text]) => ({ path, bytes: encodeUtf8(text) }));

async function demo() {
  const fs = await demoWithoutPlugins();
  return { fs, doc: new ProjectDocument(await openProject(fs)) };
}

describe('adding a plugin', () => {
  it('copies its folder, lists it turned on, and undoes the listing', async () => {
    const { fs, doc } = await demo();
    const added = await addPlugin(doc, folder('rain'));
    expect(added.id).toBe('rain');
    expect(await fs.list('plugins/rain')).toEqual([
      'plugins/rain/drop.png',
      'plugins/rain/src/main.js',
    ]);
    expect(doc.project.manifest.data.plugins).toEqual([
      { id: 'rain', path: 'plugins/rain/plugin.json', enabled: true },
    ]);
    expect(doc.project.plugins.get('rain')?.data?.name).toBe('The rain');
    expect(doc.project.plugins.get('rain')?.problems).toEqual([]);

    await doc.save();
    const reopened = await openProject(fs);
    expect([...reopened.plugins.keys()]).toEqual(['rain']);
    expect(reopened.problems).toEqual([]);

    doc.undo();
    expect(doc.project.manifest.data.plugins ?? []).toEqual([]);
  });

  it('refuses folders that aren’t plugins, broken ones and an id already listed', async () => {
    const { doc } = await demo();
    const reason = async (files: PluginSourceFile[]) =>
      addPlugin(doc, files).then(
        () => 'added',
        (e: Error) => e.message,
      );
    expect(await reason(folder('x').filter((f) => f.path !== 'plugin.json'))).toMatch(
      /no plugin\.json/,
    );
    expect(await reason(folder('x', { 'plugin.json': '{ nope' }))).toMatch(/isn’t valid JSON/);
    expect(
      await reason(
        folder('x', { 'plugin.json': JSON.stringify({ ...declaration('x'), apiVersion: 99 }) }),
      ),
    ).toMatch(/needs plugin API 99/);
    expect(await reason(folder('x').filter((f) => f.path !== 'src/main.js'))).toMatch(
      /names the script src\/main\.js, which isn’t there/,
    );
    expect(await reason(folder('x', { 'a//b.js': '' }))).toMatch(/invalid segment/);
    expect(await reason(folder('rain'))).toBe('added');
    expect(await reason(folder('rain'))).toMatch(/already has a plugin with the id “rain”/);
  });

  it('reads a picked folder through any ProjectFs, skipping hidden files', async () => {
    const picked = new MemoryFs();
    for (const f of folder('rain')) await picked.writeBytes(f.path, f.bytes);
    await picked.writeBytes('.git/HEAD', encodeUtf8('ref'));
    const files = await pluginSourceFiles(picked);
    expect(files.map((f) => f.path).sort()).toEqual(['drop.png', 'plugin.json', 'src/main.js']);
    expect(readPluginFolder(files).declaration.id).toBe('rain');
  });
});

describe('the plugin list', () => {
  it('turns plugins on and off, orders them and keeps settings that differ from defaults', async () => {
    const { doc } = await demo();
    await addPlugin(doc, folder('rain'));
    await addPlugin(doc, folder('wind'));
    const edit = (change: Parameters<typeof doc.update<'manifest'>>[3]) =>
      doc.update(MANIFEST_PATH, 'manifest', 'Edit', change);
    const refs = () => doc.project.manifest.data.plugins ?? [];

    edit((m) => movePlugin(m, 'wind', -1));
    expect(refs().map((r) => r.id)).toEqual(['wind', 'rain']);
    expect(edit((m) => movePlugin(m, 'wind', -1))).toBe(false);

    edit((m) => setPluginEnabled(m, 'rain', false));
    expect(refs()[1]?.enabled).toBe(false);

    edit((m) => setPluginSetting(m, 'rain', 'speed', 7));
    expect(refs()[1]?.settings).toEqual({ speed: 7 });
    edit((m) => setPluginSetting(m, 'rain', 'speed', 0));
    // Out of range values are kept (the form shows the problem) and reported.
    expect(doc.project.problems.map((p) => p.message)).toContainEqual(
      expect.stringContaining('speed: 0 is below the lowest, 1'),
    );
    edit((m) => setPluginSetting(m, 'rain', 'speed', undefined));
    expect(refs()[1]).toEqual({ id: 'rain', path: 'plugins/rain/plugin.json', enabled: false });
  });
});

describe('removing a plugin', () => {
  it('takes it out now and deletes its folder with the save', async () => {
    const { fs, doc } = await demo();
    await addPlugin(doc, folder('rain'));
    await doc.save();
    removePlugin(doc, 'rain');
    expect(doc.project.manifest.data.plugins).toEqual([]);
    expect(doc.project.plugins.size).toBe(0);
    // Until the save, everything is still on disk (and the removal can be undone).
    expect(await fs.list('plugins/rain')).toHaveLength(3);
    const { removed } = await doc.save();
    expect(removed).toEqual(['plugins/rain/plugin.json']);
    expect(await fs.list('plugins/rain')).toEqual([]);
    expect((await openProject(fs)).problems).toEqual([]);
  });

  it('keeps the folder when the removal is undone before saving', async () => {
    const { fs, doc } = await demo();
    await addPlugin(doc, folder('rain'));
    await doc.save();
    removePlugin(doc, 'rain');
    doc.undo();
    await doc.save();
    expect(await fs.list('plugins/rain')).toHaveLength(3);
    expect([...(await openProject(fs)).plugins.keys()]).toEqual(['rain']);
  });
});
