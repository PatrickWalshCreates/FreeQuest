// Loading the project's enabled plugins for the game: each one's script is
// imported from the project (an ES module, its default export the plugin)
// and handed to core's PluginHost. PixiJS-free; `importModule` is injected
// in tests.
import { type LoadedPlugin, PluginHost, type PluginError } from '@freequest/core';
import { type PluginDeclaration, pluginFolder } from '@freequest/schema';
import type { LoadedProject } from './loader.js';

/** Imports a script by URL and resolves to its module namespace. */
export type ImportModule = (url: string) => Promise<unknown>;

/** The browser's own dynamic import. */
export const importScript: ImportModule = (url) => import(/* @vite-ignore */ url);

/**
 * Import every enabled plugin's script, in the manifest's order, and set
 * them up. A plugin whose script can't be imported is reported through
 * `onError` and left out; the game starts without it.
 */
export async function loadPlugins(
  project: Pick<LoadedProject, 'manifest' | 'plugins' | 'assetUrl'>,
  onError: (error: PluginError) => void,
  importModule: ImportModule = importScript,
): Promise<PluginHost> {
  const loaded: LoadedPlugin[] = [];
  const failed: { declaration: PluginDeclaration; cause: unknown }[] = [];
  const enabled = (project.manifest.plugins ?? []).filter((ref) => ref.enabled);
  const modules = await Promise.all(
    enabled.map(async (ref) => {
      const declaration = project.plugins.get(ref.id);
      if (!declaration) return null;
      try {
        const url = await project.assetUrl(`${pluginFolder(ref.path)}${declaration.entry}`);
        const namespace = (await importModule(url)) as { default?: unknown } | null;
        return { ref, declaration, module: namespace?.default };
      } catch (cause) {
        failed.push({ declaration, cause });
        return null;
      }
    }),
  );
  for (const m of modules) {
    if (!m) continue;
    loaded.push({
      declaration: m.declaration,
      module: m.module,
      ...(m.ref.settings ? { settings: m.ref.settings } : {}),
    });
  }
  const host = new PluginHost(loaded, onError);
  for (const { declaration, cause } of failed) host.reportLoadFailure(declaration, cause);
  return host;
}
