// Controls for a plugin's parameters (M15 step 5): its settings in Project
// settings and its commands' arguments in event dialogs. Built from the
// declaration in plugin.json (our own parameter spec), never from code.
import {
  type PluginParam,
  type PluginReferenceType,
  type PluginValue,
  type PluginValues,
  checkPluginValues,
  pluginParamDefault,
  resolvePluginValues,
} from '@freequest/schema';
import { useId } from 'react';
import { ColorField } from '../forms/ColorField.js';
import type { FormContext, RefOption } from '../forms/SchemaField.js';

/** The form field whose dropdown lists ids of a reference kind. */
const REF_FIELDS: Record<PluginReferenceType, [string, Record<string, unknown> | null]> = {
  switch: ['switch', null],
  variable: ['variable', null],
  map: ['map', null],
  character: ['character', null],
  actor: ['actor', null],
  class: ['class', null],
  skill: ['skill', null],
  item: ['id', { kind: 'item' }],
  equipment: ['id', { kind: 'equipment' }],
  state: ['state', null],
  enemy: ['enemies', null],
  troop: ['troop', null],
  commonEvent: ['common', null],
  animation: ['animation', null],
};

export function referenceOptions(
  ctx: FormContext,
  kind: PluginReferenceType,
): readonly RefOption[] {
  const [field, parent] = REF_FIELDS[kind];
  return ctx.refs(field, parent) ?? [];
}

/**
 * Values for a new command: every parameter at its default, and required
 * references and files at the first choice the project has (like other forms).
 */
export function pluginStartValues(ctx: FormContext, params: readonly PluginParam[]): PluginValues {
  const values: Record<string, PluginValue> = { ...resolvePluginValues(params, {}) };
  for (const param of params) {
    if ((param.type !== 'reference' && param.type !== 'asset') || param.optional) continue;
    if (values[param.name] !== '') continue;
    const options =
      param.type === 'reference'
        ? referenceOptions(ctx, param.kind)
        : (ctx.assets?.(param.folder) ?? []);
    const first = options[0];
    if (first) values[param.name] = first.value;
  }
  return values;
}

/** Whether an id of this kind exists, for `checkPluginValues`. */
export function pluginIdLookup(ctx: FormContext) {
  return (kind: PluginReferenceType, id: string) =>
    referenceOptions(ctx, kind).some((o) => o.value === id);
}

/** Problems with the values, by parameter name ("" for ones about no parameter). */
export function pluginValueProblems(
  ctx: FormContext,
  params: readonly PluginParam[],
  values: PluginValues | undefined,
): Map<string, string> {
  const result = new Map<string, string>();
  const names = new Set(params.map((p) => p.name));
  for (const problem of checkPluginValues('@', params, values, pluginIdLookup(ctx))) {
    // "@ name: message" or "@: message"
    const match = /^@ ?([^:]*): (.*)$/.exec(problem);
    const name = match?.[1] ?? '';
    const key = names.has(name) ? name : '';
    result.set(key, [result.get(key), match?.[2] ?? problem].filter(Boolean).join(' · '));
  }
  return result;
}

interface Props {
  readonly params: readonly PluginParam[];
  /** The stored values; missing ones show their default. */
  readonly values: PluginValues | undefined;
  /** `undefined` means "back to the default" (settings drop the value). */
  readonly onChange: (name: string, value: PluginValue | undefined) => void;
  readonly ctx: FormContext;
}

export function PluginParamFields({ params, values, onChange, ctx }: Props) {
  const problems = pluginValueProblems(ctx, params, values);
  if (params.length === 0) return <p className="muted">Nothing to set.</p>;
  return (
    <div className="schema-fields">
      {params.map((param) => (
        <ParamField
          key={param.name}
          param={param}
          value={values?.[param.name]}
          onChange={(v) => onChange(param.name, v)}
          ctx={ctx}
          problem={problems.get(param.name) ?? null}
        />
      ))}
      {problems.get('') && <p className="error">{problems.get('')}</p>}
    </div>
  );
}

function ParamField(props: {
  readonly param: PluginParam;
  readonly value: PluginValue | undefined;
  readonly onChange: (value: PluginValue | undefined) => void;
  readonly ctx: FormContext;
  readonly problem: string | null;
}) {
  const { param, onChange, ctx, problem } = props;
  const id = useId();
  const value = props.value ?? pluginParamDefault(param);
  const label = (
    <label htmlFor={id} title={param.description}>
      {param.label}
    </label>
  );
  const wrap = (control: React.ReactNode, inline = false) => (
    <div className={inline ? 'schema-field inline-field' : 'schema-field'}>
      {label}
      {control}
      {param.description && !inline && <span className="hint">{param.description}</span>}
      {problem && <span className="field-problem">{problem}</span>}
    </div>
  );
  switch (param.type) {
    case 'boolean':
      return wrap(
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(e.target.checked)}
        />,
        true,
      );
    case 'integer':
    case 'number':
      return wrap(
        <input
          id={id}
          type="number"
          step={param.type === 'integer' ? 1 : 'any'}
          {...(param.min !== undefined ? { min: param.min } : {})}
          {...(param.max !== undefined ? { max: param.max } : {})}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            if (e.target.value === '') return;
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(param.type === 'integer' ? Math.round(n) : n);
          }}
        />,
      );
    case 'string':
      return wrap(
        param.multiline ? (
          <textarea
            id={id}
            rows={3}
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} />
        ),
      );
    case 'choice':
      return wrap(
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {param.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      );
    case 'color':
      return wrap(<ColorField value={value} onChange={(c) => onChange(c ?? undefined)} />);
    case 'reference':
    case 'asset': {
      const options =
        param.type === 'reference'
          ? referenceOptions(ctx, param.kind)
          : (ctx.assets?.(param.folder) ?? []);
      const current = String(value);
      const known = current === '' || options.some((o) => o.value === current);
      return wrap(
        <select id={id} value={current} onChange={(e) => onChange(e.target.value)}>
          {(param.optional || current === '') && (
            <option value="">{param.optional ? '(none)' : '(choose one)'}</option>
          )}
          {!known && <option value={current}>{current} (missing)</option>}
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>,
      );
    }
  }
}
