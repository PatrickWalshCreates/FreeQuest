// Add or edit a plugin's command (M15 step 5): the fields come from the
// command's parameters in plugin.json.
import type { Command, PluginValues } from '@freequest/schema';
import { pluginParamDefault } from '@freequest/schema';
import { useState } from 'react';
import { Dialog } from '../Dialog.js';
import type { FormContext } from '../forms/SchemaField.js';
import { PluginParamFields, pluginValueProblems } from './PluginParamFields.js';

type PluginCommand = Extract<Command, { type: 'plugin' }>;

interface Props {
  readonly command: PluginCommand;
  readonly ctx: FormContext;
  readonly okLabel: string;
  readonly onOk: (command: PluginCommand) => void;
  readonly onClose: () => void;
}

export function PluginCommandDialog({ command, ctx, okLabel, onOk, onClose }: Props) {
  const [args, setArgs] = useState<PluginValues>(command.args);
  const plugin = ctx.plugins?.().find((p) => p.declaration.id === command.plugin);
  const declared = plugin?.declaration.commands.find((c) => c.id === command.command);
  const title = plugin
    ? `${plugin.declaration.name}: ${declared?.label ?? command.command}`
    : `Plugin command: ${command.plugin} › ${command.command}`;

  if (!plugin || !declared) {
    return (
      <Dialog title={title} onClose={onClose}>
        <p className="error">
          {plugin
            ? `The plugin ${plugin.declaration.name} has no command “${command.command}” (any more).`
            : `The project has no plugin “${command.plugin}”. Add it in Project settings › Plugins to edit this command.`}
        </p>
        <div className="actions">
          <button className="primary" onClick={onClose}>
            Close
          </button>
        </div>
      </Dialog>
    );
  }
  const problems = pluginValueProblems(ctx, declared.params, args);
  const problem = problems.size > 0 ? 'Fix the fields marked above first.' : null;
  return (
    <Dialog title={title} onClose={onClose}>
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!problem) onOk({ ...command, args });
        }}
      >
        {declared.description && <p className="hint">{declared.description}</p>}
        {!plugin.enabled && (
          <p className="muted">
            This plugin is turned off: the command does nothing until it’s turned on in Project
            settings › Plugins.
          </p>
        )}
        <PluginParamFields
          params={declared.params}
          values={args}
          ctx={ctx}
          onChange={(name, value) => {
            const param = declared.params.find((p) => p.name === name);
            if (!param) return;
            setArgs({ ...args, [name]: value ?? pluginParamDefault(param) });
          }}
        />
        {problem && <p className="error">{problem}</p>}
        <div className="actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={problem !== null}>
            {okLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
