import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PluginError } from '@freequest/core';
import type { Manifest, PluginDeclaration } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { type ProjectSource, loadProject } from '../src/loader.js';
import { loadPlugins } from '../src/plugins.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');

const declaration = (id: string, extra: Partial<PluginDeclaration> = {}): PluginDeclaration => ({
  formatVersion: 1,
  id,
  name: id.toUpperCase(),
  version: '1.0.0',
  apiVersion: 1,
  entry: 'main.js',
  settings: [{ name: 'speed', label: 'Speed', type: 'integer', default: 1 }],
  commands: [],
  ...extra,
});

/** The demo with plugins listed: `enabled` per id, declarations as given. */
async function project(
  plugins: { decl: PluginDeclaration; enabled: boolean; settings?: Record<string, number> }[],
): Promise<ProjectSource> {
  const manifest = JSON.parse(await readFile(join(DEMO, 'project.json'), 'utf8')) as Manifest;
  manifest.plugins = plugins.map(({ decl, enabled, settings }) => ({
    id: decl.id,
    path: `plugins/${decl.id}/plugin.json`,
    enabled,
    ...(settings ? { settings } : {}),
  }));
  const files = new Map<string, unknown>([['project.json', manifest]]);
  for (const { decl } of plugins) files.set(`plugins/${decl.id}/plugin.json`, decl);
  return {
    async readJson(path) {
      return files.get(path) ?? (JSON.parse(await readFile(join(DEMO, path), 'utf8')) as unknown);
    },
    assetUrl: (path) => Promise.resolve(`asset:${path}`),
  };
}

describe('loading plugins', () => {
  it('reads every listed declaration, on or off', async () => {
    const loaded = await loadProject(
      await project([
        { decl: declaration('rain'), enabled: true },
        { decl: declaration('clock'), enabled: false },
      ]),
    );
    expect([...loaded.plugins.keys()]).toEqual(['rain', 'clock']);
  });

  it('refuses a plugin that needs a newer FreeQuest', async () => {
    await expect(
      loadProject(
        await project([{ decl: declaration('rain', { apiVersion: 99 }), enabled: true }]),
      ),
    ).rejects.toThrow(/plugins\/rain\/plugin\.json[\s\S]*needs plugin API 99/);
  });

  it('imports enabled plugins’ scripts in order, with their settings, and skips the rest', async () => {
    const loaded = await loadProject(
      await project([
        { decl: declaration('rain'), enabled: true, settings: { speed: 3 } },
        { decl: declaration('clock'), enabled: false },
        { decl: declaration('wind', { entry: 'src/index.mjs' }), enabled: true },
      ]),
    );
    const imported: string[] = [];
    const set: unknown[] = [];
    const host = await loadPlugins(
      loaded,
      (e) => {
        throw e;
      },
      async (url) => {
        imported.push(url);
        return {
          default: {
            setup: (api: { id: string; settings: unknown }) => set.push([api.id, api.settings]),
          },
        };
      },
    );
    expect(imported.sort()).toEqual([
      'asset:plugins/rain/main.js',
      'asset:plugins/wind/src/index.mjs',
    ]);
    expect(set).toEqual([
      ['rain', { speed: 3 }],
      ['wind', { speed: 1 }],
    ]);
    expect(host.status.map((s) => s.id)).toEqual(['rain', 'wind']);
  });

  it('reports a script that can’t be imported and starts without it', async () => {
    const loaded = await loadProject(
      await project([
        { decl: declaration('rain'), enabled: true },
        { decl: declaration('wind'), enabled: true },
      ]),
    );
    const errors: PluginError[] = [];
    const host = await loadPlugins(
      loaded,
      (e) => errors.push(e),
      async (url) => {
        if (url.includes('rain')) throw new SyntaxError('Unexpected token');
        return { default: { setup() {} } };
      },
    );
    expect(errors.map((e) => e.message)).toEqual([
      'Plugin "RAIN" stopped working (load): Unexpected token',
    ]);
    expect(host.status).toEqual([{ id: 'wind', name: 'WIND', version: '1.0.0', working: true }]);
  });
});
