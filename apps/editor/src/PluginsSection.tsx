// Project settings: the project's plugins (M15 step 5). Add a plugin folder
// (copied into plugins/<id>/), turn plugins on and off, set their order and
// settings, see where their commands are used, remove them. Everything comes
// from plugin.json: the editor never runs plugin code.
import {
  MANIFEST_PATH,
  type PluginSourceFile,
  type ProjectDocument,
  addPlugin,
  movePlugin,
  pluginSourceFiles,
  removePlugin,
  setPluginEnabled,
  setPluginSetting,
  usagesOf,
} from '@freequest/editor-core';
import type { Manifest } from '@freequest/schema';
import { useMemo, useRef, useState } from 'react';
import { projectFormContext } from './forms/project-context.js';
import { useProjectLists } from './forms/use-project-lists.js';
import { IN_DESKTOP_APP, confirmAction, pickPluginFolder } from './platform.js';
import { PluginParamFields } from './plugins/PluginParamFields.js';

/** Files from a folder input: paths start with the folder's own name, which is dropped. */
async function inputFiles(list: readonly File[]): Promise<PluginSourceFile[]> {
  return Promise.all(
    list.map(async (file) => ({
      path: file.webkitRelativePath.split('/').slice(1).join('/') || file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

export function PluginsSection({ doc }: { readonly doc: ProjectDocument }) {
  const project = doc.project;
  const refs = project.manifest.data.plugins ?? [];
  const lists = useProjectLists(doc);
  const ctx = useMemo(() => projectFormContext(project, lists), [project, lists]);
  const [open, setOpen] = useState<{
    readonly id: string;
    readonly what: 'settings' | 'uses';
  } | null>(null);
  const [message, setMessage] = useState<{ readonly error: boolean; readonly text: string } | null>(
    null,
  );
  const input = useRef<HTMLInputElement>(null);
  const edit = (label: string, change: (m: Manifest) => Manifest, coalesce?: string) =>
    doc.update(MANIFEST_PATH, 'manifest', label, change, coalesce ? { coalesce } : {});

  const add = async (read: () => Promise<PluginSourceFile[] | null>) => {
    setMessage(null);
    try {
      const files = await read();
      if (!files) return;
      const declaration = await addPlugin(doc, files);
      setMessage({
        error: false,
        text: `Added ${declaration.name} ${declaration.version}. Its files are in plugins/${declaration.id}/.`,
      });
    } catch (error) {
      setMessage({ error: true, text: error instanceof Error ? error.message : String(error) });
    }
  };
  const chooseFolder = () => {
    if (IN_DESKTOP_APP) {
      void add(async () => {
        const fs = await pickPluginFolder();
        return fs ? pluginSourceFiles(fs) : null;
      });
    } else input.current?.click();
  };
  const remove = async (id: string, name: string) => {
    const uses = usagesOf(project, 'plugin', id);
    const warning =
      uses.length > 0
        ? ` Its commands are used by ${uses.length === 1 ? uses[0] : `${uses.length} places: ${uses.join(', ')}`}; they will show a problem until you change them.`
        : '';
    const ok = await confirmAction(
      `Remove the plugin “${name}”?${warning} Its folder (plugins/${id}/) is deleted when you save; you can undo this until then.`,
      { title: 'Remove plugin', okLabel: 'Remove' },
    );
    if (ok) removePlugin(doc, id);
  };

  return (
    <section className="plugins" onBlur={() => doc.endCoalescing()}>
      <h2>Plugins</h2>
      <p className="hint">
        Scripts that add to the game: commands for events, things drawn over the map. They run in
        the game (in playtests, in a sandbox, after you agree), never in the editor. Plugins start
        in this order.
      </p>
      {refs.length === 0 && <p className="muted">No plugins yet.</p>}
      <ul>
        {refs.map((ref, index) => {
          const file = project.plugins.get(ref.id);
          const declaration = file?.data;
          const name = declaration?.name ?? ref.id;
          const uses = usagesOf(project, 'plugin', ref.id);
          const settings = declaration?.settings ?? [];
          const isOpen = (what: 'settings' | 'uses') => open?.id === ref.id && open.what === what;
          const toggle = (what: 'settings' | 'uses') =>
            setOpen(isOpen(what) ? null : { id: ref.id, what });
          return (
            <li key={ref.id} className={ref.enabled ? 'plugin' : 'plugin off'}>
              <div className="row">
                <label className="plugin-on" title="Turned off, the game doesn't load it">
                  <input
                    type="checkbox"
                    checked={ref.enabled}
                    onChange={(e) =>
                      edit(`${e.target.checked ? 'Turn on' : 'Turn off'} plugin ${name}`, (m) =>
                        setPluginEnabled(m, ref.id, e.target.checked),
                      )
                    }
                  />
                  <strong>{name}</strong>
                </label>
                <span className="muted">
                  {declaration ? `${declaration.version} · ` : ''}
                  <code>{ref.id}</code>
                </span>
                <span className="spacer" />
                <button
                  className="small"
                  aria-label={`Move ${name} up`}
                  disabled={index === 0}
                  onClick={() => edit('Move plugin', (m) => movePlugin(m, ref.id, -1))}
                >
                  ↑
                </button>
                <button
                  className="small"
                  aria-label={`Move ${name} down`}
                  disabled={index === refs.length - 1}
                  onClick={() => edit('Move plugin', (m) => movePlugin(m, ref.id, 1))}
                >
                  ↓
                </button>
                <button
                  className="small"
                  aria-expanded={isOpen('settings')}
                  disabled={settings.length === 0}
                  title={settings.length === 0 ? 'This plugin has no settings' : undefined}
                  onClick={() => toggle('settings')}
                >
                  Settings
                </button>
                <button
                  className="small"
                  aria-expanded={isOpen('uses')}
                  disabled={uses.length === 0}
                  title={uses.length > 0 ? 'Show where its commands are used' : 'Nothing uses it'}
                  onClick={() => toggle('uses')}
                >
                  {uses.length === 0 ? 'Unused' : `Used by ${uses.length}`}
                </button>
                <button className="small danger" onClick={() => void remove(ref.id, name)}>
                  Remove…
                </button>
              </div>
              {declaration?.description && <p className="hint">{declaration.description}</p>}
              {file?.problems.map((p) => (
                <p key={p} className="error">
                  {p}
                </p>
              ))}
              {!file && <p className="error">plugins/{ref.id}/plugin.json is missing.</p>}
              {isOpen('settings') && declaration && (
                <PluginParamFields
                  params={settings}
                  values={ref.settings}
                  ctx={ctx}
                  onChange={(setting, value) =>
                    edit(
                      `Change ${name} setting`,
                      (m) => setPluginSetting(m, ref.id, setting, value),
                      `plugin-setting:${ref.id}:${setting}`,
                    )
                  }
                />
              )}
              {isOpen('uses') && (
                <ul className="used-by">
                  {uses.map((u) => (
                    <li key={u}>{u}</li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button className="small" onClick={chooseFolder}>
          + Add a plugin folder…
        </button>
        <input
          ref={input}
          type="file"
          hidden
          // A folder picker in the browser (the desktop app uses the system dialog).
          {...{ webkitdirectory: '' }}
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = '';
            if (files.length > 0) void add(() => inputFiles(files));
          }}
        />
      </div>
      {message && <p className={message.error ? 'error' : 'muted'}>{message.text}</p>}
    </section>
  );
}
