// Plugins (M15): `plugins/<id>/plugin.json` declares a plugin's name, the
// script the game runs, its settings and the event commands it adds. Every
// parameter is declared here as plain data, so the editor can show forms and
// check projects without ever running a plugin's code.
import Type, { type Static } from 'typebox';
import { Id } from './common.js';

export const PLUGIN_FORMAT_VERSION = 1;

/** The newest plugin API this FreeQuest runs. A plugin asking for a newer one needs an update. */
export const PLUGIN_API_VERSION = 1;

/** Where a plugin's declaration lives: `plugins/<id>/plugin.json`. */
export const PLUGIN_PATH_PATTERN = '^plugins/[a-z0-9][a-z0-9_-]*/plugin\\.json$';

/** The declaration path of the plugin with this id. */
export function pluginPath(id: string): string {
  return `plugins/${id}/plugin.json`;
}

/** The folder holding a plugin's files ("plugins/<id>/"), from its declaration path. */
export function pluginFolder(path: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1);
}

/** A parameter's name: how the plugin's script reads its value (`args.speed`). */
export const PARAM_NAME_PATTERN = '^[a-zA-Z][a-zA-Z0-9_]*$';
const ParamName = Type.String({ pattern: PARAM_NAME_PATTERN });

/** A value of a setting or a command argument. */
export const PluginValue = Type.Union([Type.Boolean(), Type.Number(), Type.String()]);
export type PluginValue = Static<typeof PluginValue>;

/** Values by parameter name. */
export const PluginValues = Type.Record(Type.String(), PluginValue);
export type PluginValues = Static<typeof PluginValues>;

/** Kinds of id a parameter can name; the editor offers a dropdown of them. */
export const PLUGIN_REFERENCE_TYPES = [
  'switch',
  'variable',
  'map',
  'character',
  'actor',
  'class',
  'skill',
  'item',
  'equipment',
  'state',
  'enemy',
  'troop',
  'commonEvent',
  'animation',
] as const;
export type PluginReferenceType = (typeof PLUGIN_REFERENCE_TYPES)[number];

const paramBase = {
  name: ParamName,
  label: Type.String({ minLength: 1, description: 'What the editor calls it.' }),
  description: Type.Optional(Type.String()),
};

/** One setting or command parameter. Leaving out `default` gives the type's own (0, "", off…). */
export const PluginParam = Type.Union([
  Type.Object(
    { ...paramBase, type: Type.Literal('boolean'), default: Type.Optional(Type.Boolean()) },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('integer'),
      min: Type.Optional(Type.Integer()),
      max: Type.Optional(Type.Integer()),
      default: Type.Optional(Type.Integer()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('number'),
      min: Type.Optional(Type.Number()),
      max: Type.Optional(Type.Number()),
      default: Type.Optional(Type.Number()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('string'),
      multiline: Type.Optional(Type.Boolean()),
      default: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('choice'),
      options: Type.Array(
        Type.Object(
          { value: Type.String({ minLength: 1 }), label: Type.String({ minLength: 1 }) },
          { additionalProperties: false },
        ),
        { minItems: 1 },
      ),
      default: Type.Optional(Type.String()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('color'),
      default: Type.Optional(Type.String({ pattern: '^#[0-9a-fA-F]{6}$' })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('reference'),
      kind: Type.Union([
        Type.Literal('switch'),
        Type.Literal('variable'),
        Type.Literal('map'),
        Type.Literal('character'),
        Type.Literal('actor'),
        Type.Literal('class'),
        Type.Literal('skill'),
        Type.Literal('item'),
        Type.Literal('equipment'),
        Type.Literal('state'),
        Type.Literal('enemy'),
        Type.Literal('troop'),
        Type.Literal('commonEvent'),
        Type.Literal('animation'),
      ]),
      optional: Type.Optional(
        Type.Boolean({ description: 'It may be left empty (otherwise it must be given).' }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      ...paramBase,
      type: Type.Literal('asset'),
      folder: Type.Optional(
        Type.String({
          pattern: '^assets(/[^/]+)*$',
          description: 'Where the editor looks for files, e.g. "assets/pictures".',
        }),
      ),
      optional: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
]);
export type PluginParam = Static<typeof PluginParam>;

/** An event command a plugin adds. */
export const PluginCommand = Type.Object(
  {
    id: Id,
    label: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String()),
    params: Type.Array(PluginParam),
  },
  { additionalProperties: false },
);
export type PluginCommand = Static<typeof PluginCommand>;

/** `plugins/<id>/plugin.json`. */
export const PluginDeclaration = Type.Object(
  {
    formatVersion: Type.Literal(PLUGIN_FORMAT_VERSION),
    id: Id,
    name: Type.String({ minLength: 1 }),
    version: Type.String({ minLength: 1, description: "The plugin's own version, e.g. 1.0.0." }),
    apiVersion: Type.Integer({
      minimum: 1,
      description: 'The FreeQuest plugin API it was written for.',
    }),
    description: Type.Optional(Type.String()),
    author: Type.Optional(Type.String()),
    entry: Type.String({
      pattern: '^(?!.*(^|/)\\.\\.?(/|$))[A-Za-z0-9_][A-Za-z0-9_./-]*\\.m?js$',
      description: 'The script the game runs, relative to the plugin folder, e.g. "main.js".',
    }),
    settings: Type.Array(PluginParam),
    commands: Type.Array(PluginCommand),
  },
  { title: 'FreeQuest plugin', additionalProperties: false },
);
export type PluginDeclaration = Static<typeof PluginDeclaration>;

/** The manifest's entry for a plugin the project uses (manifest v10). */
export const PluginRef = Type.Object(
  {
    id: Id,
    path: Type.String({ pattern: PLUGIN_PATH_PATTERN }),
    enabled: Type.Boolean({
      description: 'Turned off: the game doesn’t load it and its commands do nothing.',
    }),
    settings: Type.Optional(PluginValues),
  },
  { additionalProperties: false },
);
export type PluginRef = Static<typeof PluginRef>;

/** A parameter's value when none is given (references and assets: "", meaning none). */
export function pluginParamDefault(param: PluginParam): PluginValue {
  switch (param.type) {
    case 'boolean':
      return param.default ?? false;
    case 'integer':
    case 'number':
      if (param.default !== undefined) return param.default;
      // 0, moved into the allowed range.
      if (param.min !== undefined && param.min > 0) return param.min;
      if (param.max !== undefined && param.max < 0) return param.max;
      return 0;
    case 'string':
      return param.default ?? '';
    case 'choice':
      return param.default ?? param.options[0]?.value ?? '';
    case 'color':
      return param.default ?? '#ffffff';
    case 'reference':
    case 'asset':
      return '';
  }
}

/** Given values with every missing one filled in by its default, in declaration order. */
export function resolvePluginValues(
  params: readonly PluginParam[],
  values: PluginValues | undefined,
): Record<string, PluginValue> {
  return Object.fromEntries(params.map((p) => [p.name, values?.[p.name] ?? pluginParamDefault(p)]));
}

/** What a parameter value is checked against: the ids that exist, by kind. */
export type PluginIdLookup = (kind: PluginReferenceType, id: string) => boolean;

/**
 * Problems with values given for these parameters: unknown names, wrong
 * types, out of range, choices that don't exist, missing references, ids that
 * don't exist (when `exists` is given). Each starts with `where`.
 */
export function checkPluginValues(
  where: string,
  params: readonly PluginParam[],
  values: PluginValues | undefined,
  exists?: PluginIdLookup,
): string[] {
  const problems: string[] = [];
  const byName = new Map(params.map((p) => [p.name, p]));
  for (const name of Object.keys(values ?? {})) {
    if (!byName.has(name)) problems.push(`${where}: no parameter "${name}"`);
  }
  for (const param of params) {
    const value = values?.[param.name];
    const at = `${where} ${param.name}`;
    if (value === undefined) {
      if ((param.type === 'reference' || param.type === 'asset') && !param.optional) {
        problems.push(`${at}: needs a value`);
      }
      continue;
    }
    const expected =
      param.type === 'boolean'
        ? 'boolean'
        : param.type === 'integer' || param.type === 'number'
          ? 'number'
          : 'string';
    if (typeof value !== expected) {
      problems.push(`${at}: should be ${expected === 'boolean' ? 'on or off' : `a ${expected}`}`);
      continue;
    }
    switch (param.type) {
      case 'integer':
      case 'number': {
        const n = value as number;
        if (param.type === 'integer' && !Number.isSafeInteger(n)) {
          problems.push(`${at}: should be a whole number`);
        } else if (!Number.isFinite(n)) problems.push(`${at}: should be a number`);
        else if (param.min !== undefined && n < param.min) {
          problems.push(`${at}: ${n} is below the lowest, ${param.min}`);
        } else if (param.max !== undefined && n > param.max) {
          problems.push(`${at}: ${n} is above the highest, ${param.max}`);
        }
        break;
      }
      case 'choice':
        if (!param.options.some((o) => o.value === value)) {
          problems.push(`${at}: "${String(value)}" isn't one of its choices`);
        }
        break;
      case 'color':
        if (!/^#[0-9a-fA-F]{6}$/.test(value as string)) {
          problems.push(`${at}: "${String(value)}" isn't a colour (#rrggbb)`);
        }
        break;
      case 'reference':
        if (value === '') {
          if (!param.optional) problems.push(`${at}: needs a value`);
        } else if (exists && !exists(param.kind, value as string)) {
          problems.push(`${at}: unknown ${referenceLabel(param.kind)} "${String(value)}"`);
        }
        break;
      case 'asset':
        if (value === '') {
          if (!param.optional) problems.push(`${at}: needs a value`);
        } else if (!(value as string).startsWith('assets/')) {
          problems.push(`${at}: "${String(value)}" isn't a file under assets/`);
        }
        break;
    }
  }
  return problems;
}

function referenceLabel(kind: PluginReferenceType): string {
  return kind === 'commonEvent' ? 'common event' : kind;
}

/**
 * Problems a declaration has on its own: an API newer than this FreeQuest,
 * repeated names, defaults that break their own rules.
 */
export function checkPluginShape(plugin: PluginDeclaration): string[] {
  const problems: string[] = [];
  if (plugin.apiVersion > PLUGIN_API_VERSION) {
    problems.push(
      `needs plugin API ${plugin.apiVersion}, but this FreeQuest has ${PLUGIN_API_VERSION}: update FreeQuest to use it`,
    );
  }
  const checkParams = (where: string, params: readonly PluginParam[]) => {
    const seen = new Set<string>();
    for (const param of params) {
      if (seen.has(param.name)) problems.push(`${where}: "${param.name}" is declared twice`);
      seen.add(param.name);
      if ((param.type === 'integer' || param.type === 'number') && param.min !== undefined) {
        if (param.max !== undefined && param.min > param.max) {
          problems.push(`${where} ${param.name}: min ${param.min} is above max ${param.max}`);
        }
      }
      if (param.type === 'choice') {
        const values = new Set<string>();
        for (const o of param.options) {
          if (values.has(o.value)) {
            problems.push(`${where} ${param.name}: choice "${o.value}" is declared twice`);
          }
          values.add(o.value);
        }
      }
      if ('default' in param && param.default !== undefined) {
        problems.push(
          ...checkPluginValues(`${where} default of`, [param], { [param.name]: param.default }),
        );
      }
    }
  };
  checkParams('settings', plugin.settings);
  const commands = new Set<string>();
  for (const command of plugin.commands) {
    if (commands.has(command.id)) problems.push(`command "${command.id}" is declared twice`);
    commands.add(command.id);
    checkParams(`command "${command.id}"`, command.params);
  }
  return problems;
}
