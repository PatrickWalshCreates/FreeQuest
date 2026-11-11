// A form control for any value of the project format, built from its
// schema: dropdowns for literal unions and references, number inputs with
// the schema's limits, nested objects and lists. Command lists inside
// commands are left to the command tree editor.
import {
  type DefaultPicker,
  type JsonSchema,
  classify,
  defaultFor,
  fieldLabel,
  fieldsOf,
  variantIndex,
  variantLabel,
} from '@freequest/editor-core';
import { type ReactNode, useId } from 'react';

export interface RefOption {
  readonly value: string;
  readonly label: string;
}

export interface FormContext {
  /**
   * Choices for a string field that refers to something in the project
   * (a map, a switch, an item…), or null for free text. `parent` is the
   * object holding the field, for fields whose meaning depends on a sibling.
   */
  refs(
    field: string,
    parent: Readonly<Record<string, unknown>> | null,
  ): readonly RefOption[] | null;
  /** Fields edited in a multi-line text box. */
  multiline?(field: string): boolean;
  /** Labels to use instead of the generated "Field name". */
  label?(field: string): string | undefined;
  /** Starting values for new objects (e.g. the first switch for a new condition). */
  pick: DefaultPicker;
  /** A problem with a field's current value to show under it (e.g. a formula that won't parse). */
  check?(field: string, value: unknown): string | null;
  /** A custom control for a field (e.g. a route's steps), or undefined for the generated one. */
  render?(field: string, value: unknown, onChange: (value: unknown) => void): ReactNode | undefined;
}

type Record_ = Readonly<Record<string, unknown>>;

interface FieldProps {
  readonly name: string;
  readonly schema: JsonSchema;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
  readonly ctx: FormContext;
  readonly parent: Record_ | null;
}

/** Labels for the non-object variants of a union (e.g. an amount that's a number or a variable). */
const VARIANT_NAMES: Record<string, string> = {
  integer: 'Number',
  number: 'Number',
  variable: 'Variable',
};

function labelFor(ctx: FormContext, name: string): string {
  return ctx.label?.(name) ?? fieldLabel(name);
}

/** True for `T[]` where T is a reference (a nested command list). */
function isRefList(schema: JsonSchema): boolean {
  const shape = classify(schema);
  return shape.kind === 'array' && classify(shape.item).kind === 'ref';
}

/** The fields of an object, each with its label. */
export function ObjectFields(props: {
  readonly schema: JsonSchema;
  readonly value: Record_;
  readonly onChange: (value: Record_) => void;
  readonly ctx: FormContext;
  /** Fields not to show (edited elsewhere, like an entry's fixed id). */
  readonly omit?: readonly string[];
}) {
  const { schema, value, onChange, ctx, omit } = props;
  const set = (name: string, next: unknown) => {
    if (next === undefined) {
      const { [name]: _removed, ...rest } = value;
      onChange(rest);
    } else onChange({ ...value, [name]: next });
  };
  const fields = fieldsOf(schema);
  const visible = fields.filter(
    (f) => classify(f.schema).kind !== 'fixed' && !omit?.includes(f.name),
  );
  if (visible.length === 0) return null;
  const numbersOnly =
    fields.length > 2 &&
    fields.every((f) => ['number', 'integer'].includes(classify(f.schema).kind));
  return (
    <div className={numbersOnly ? 'schema-fields compact' : 'schema-fields'}>
      {fields.map((field) => {
        const shape = classify(field.schema);
        if (shape.kind === 'fixed' || omit?.includes(field.name)) return null;
        // Nested command lists: required ones are always there; optional ones are a toggle.
        if (isRefList(field.schema)) {
          if (field.required) return null;
          return (
            <label key={field.name} className="toggle">
              <input
                type="checkbox"
                checked={value[field.name] !== undefined}
                onChange={(e) => set(field.name, e.target.checked ? [] : undefined)}
              />
              “{labelFor(ctx, field.name)}” branch
            </label>
          );
        }
        // An optional group of fields (e.g. the iconset): on/off, filled with defaults when on.
        if (!field.required && shape.kind === 'object') {
          const present = value[field.name] !== undefined;
          return (
            <div key={field.name} className="schema-field">
              <label className="toggle" title={field.schema.description}>
                <input
                  type="checkbox"
                  checked={present}
                  onChange={(e) =>
                    set(
                      field.name,
                      e.target.checked ? defaultFor(field.schema, ctx.pick, field.name) : undefined,
                    )
                  }
                />
                {labelFor(ctx, field.name)}
              </label>
              {present && (
                <ObjectFields
                  schema={field.schema}
                  value={value[field.name] as Record_}
                  onChange={(next) => set(field.name, next)}
                  ctx={ctx}
                />
              )}
            </div>
          );
        }
        const problem = ctx.check?.(field.name, value[field.name]) ?? null;
        const custom = ctx.render?.(field.name, value[field.name], (next) => set(field.name, next));
        if (custom !== undefined) {
          return (
            <Labeled
              key={field.name}
              label={labelFor(ctx, field.name)}
              hint={field.schema.description}
              inline={false}
              problem={problem}
            >
              {() => custom}
            </Labeled>
          );
        }
        return (
          <Labeled
            key={field.name}
            label={labelFor(ctx, field.name)}
            hint={field.schema.description}
            inline={shape.kind === 'boolean'}
            problem={problem}
          >
            {(id) => (
              <Control
                id={id}
                name={field.name}
                schema={field.schema}
                value={value[field.name]}
                optional={!field.required}
                onChange={(next) => set(field.name, next)}
                ctx={ctx}
                parent={value}
              />
            )}
          </Labeled>
        );
      })}
    </div>
  );
}

function Labeled(props: {
  readonly label: string;
  readonly hint: string | undefined;
  readonly inline?: boolean;
  readonly problem?: string | null;
  readonly children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className={props.inline ? 'schema-field inline-field' : 'schema-field'}>
      <label htmlFor={id} title={props.hint}>
        {props.label}
      </label>
      {props.children(id)}
      {props.problem && <span className="field-problem">{props.problem}</span>}
    </div>
  );
}

/** The control for one value; `optional` adds a "none" choice that removes it. */
function Control(props: FieldProps & { readonly id: string; readonly optional: boolean }) {
  const { id, name, schema, value, onChange, ctx, parent, optional } = props;
  const shape = classify(schema);
  const none = optional ? '(none)' : null;

  switch (shape.kind) {
    case 'fixed':
    case 'ref':
      return null;
    case 'choice':
      return (
        <Select
          id={id}
          value={value === undefined ? '' : String(value)}
          none={none}
          options={shape.options.map((o) => ({ value: String(o), label: String(o) }))}
          onChange={(v) =>
            onChange(v === '' ? undefined : shape.options.find((o) => String(o) === v))
          }
        />
      );
    case 'nullable': {
      // e.g. music: a file, or null to stop it.
      const refs = ctx.refs(name, parent);
      if (refs) {
        return (
          <Select
            id={id}
            value={value === null || value === undefined ? '' : String(value)}
            none="(none)"
            options={refs}
            onChange={(v) => onChange(v === '' ? null : v)}
          />
        );
      }
      return (
        <div className="nullable">
          <label className="toggle">
            <input
              type="checkbox"
              checked={value === null}
              onChange={(e) =>
                onChange(e.target.checked ? null : defaultFor(shape.inner, ctx.pick, name))
              }
            />
            None
          </label>
          {value !== null && <Control {...props} schema={shape.inner} optional={false} />}
        </div>
      );
    }
    case 'union': {
      const index = variantIndex(shape.variants, value);
      const variant = shape.variants[index] ?? {};
      const isObject = classify(variant).kind === 'object';
      return (
        <div className="union">
          <select
            id={id}
            value={index}
            onChange={(e) => {
              const next = shape.variants[Number(e.target.value)];
              if (next) onChange(defaultFor(next, ctx.pick, name));
            }}
          >
            {shape.variants.map((v, i) => {
              const label = variantLabel(v);
              return (
                <option key={i} value={i}>
                  {VARIANT_NAMES[label] ?? fieldLabel(label)}
                </option>
              );
            })}
          </select>
          {isObject ? (
            <ObjectFields
              schema={variant}
              value={(value ?? {}) as Record_}
              onChange={onChange}
              ctx={ctx}
            />
          ) : (
            <Control {...props} schema={variant} optional={false} />
          )}
        </div>
      );
    }
    case 'string': {
      const refs = ctx.refs(name, parent);
      const text = typeof value === 'string' ? value : '';
      if (refs) {
        const known = refs.some((r) => r.value === text);
        return (
          <Select
            id={id}
            value={text}
            none={none}
            options={known || !text ? refs : [{ value: text, label: `${text} (missing)` }, ...refs]}
            onChange={(v) => onChange(v === '' && optional ? undefined : v)}
          />
        );
      }
      const change = (v: string) => onChange(v === '' && optional ? undefined : v);
      return ctx.multiline?.(name) ? (
        <textarea id={id} value={text} rows={3} onChange={(e) => change(e.target.value)} />
      ) : (
        <input id={id} value={text} onChange={(e) => change(e.target.value)} />
      );
    }
    case 'number':
    case 'integer':
      return (
        <input
          id={id}
          type="number"
          value={typeof value === 'number' ? value : ''}
          min={schema.minimum ?? schema.exclusiveMinimum}
          max={schema.maximum}
          step={shape.kind === 'integer' ? 1 : 'any'}
          placeholder={optional ? '(none)' : undefined}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isNaN(n)) {
              if (optional) onChange(undefined);
              return;
            }
            onChange(shape.kind === 'integer' ? Math.trunc(n) : n);
          }}
        />
      );
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(e) => onChange(optional && !e.target.checked ? undefined : e.target.checked)}
        />
      );
    case 'object':
      return (
        <ObjectFields
          schema={schema}
          value={(value ?? {}) as Record_}
          onChange={onChange}
          ctx={ctx}
        />
      );
    case 'record':
      return (
        <RecordControl
          id={id}
          name={name}
          keys={shape.keys}
          valueSchema={shape.value}
          minimum={schema.minProperties ?? 0}
          value={(value ?? {}) as Readonly<Record<string, unknown>>}
          onChange={onChange}
          ctx={ctx}
        />
      );
    case 'array': {
      const items = Array.isArray(value) ? (value as unknown[]) : [];
      const min = schema.minItems ?? 0;
      return (
        <div className="schema-list">
          {items.map((item, i) => (
            <div key={i} className="schema-list-item">
              <Control
                {...props}
                id={`${id}-${i}`}
                schema={shape.item}
                value={item}
                optional={false}
                parent={null}
                onChange={(next) => onChange(items.map((x, j) => (j === i ? next : x)))}
              />
              <button
                type="button"
                className="icon"
                aria-label={`Remove item ${i + 1}`}
                disabled={items.length <= min}
                onClick={() => onChange(items.filter((_, j) => j !== i))}
              >
                ×
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange([...items, defaultFor(shape.item, ctx.pick, name)])}
          >
            + Add
          </button>
        </div>
      );
    }
  }
}

function Select(props: {
  readonly id: string;
  readonly value: string;
  readonly none: string | null;
  readonly options: readonly RefOption[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <select id={props.id} value={props.value} onChange={(e) => props.onChange(e.target.value)}>
      {props.none !== null && <option value="">{props.none}</option>}
      {props.options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Key → value rows: a level curve (level → value, sorted by level) or a
 * map like slot → equipment. Refs for keys and values are asked for as
 * "<field>:key" and "<field>:value".
 */
function RecordControl(props: {
  readonly id: string;
  readonly name: string;
  readonly keys: 'integer' | 'string';
  readonly valueSchema: JsonSchema;
  readonly minimum: number;
  readonly value: Readonly<Record<string, unknown>>;
  readonly onChange: (value: unknown) => void;
  readonly ctx: FormContext;
}) {
  const { id, name, keys, valueSchema, minimum, value, onChange, ctx } = props;
  // Integer-like keys always come out in numeric order, so level curves read 1, 5, 10.
  const entries = Object.entries(value);
  const keyRefs = ctx.refs(`${name}:key`, null);
  const rebuild = (next: [string, unknown][]) => onChange(Object.fromEntries(next));
  const freeKey = (): string | null => {
    if (keys === 'integer') {
      const last = Math.max(0, ...entries.map(([k]) => Number(k)));
      return String(last + 1);
    }
    const used = new Set(entries.map(([k]) => k));
    return keyRefs?.find((r) => !used.has(r.value))?.value ?? (used.has('') ? null : '');
  };
  const nextKey = freeKey();
  return (
    <div className="record">
      {entries.map(([key, item], i) => (
        // Keyed by position: keying by the key would remount the row (and drop focus) as you type it.
        <div key={i} className="record-row">
          {keys === 'integer' ? (
            <input
              id={i === 0 ? id : undefined}
              className="record-key"
              type="number"
              min={1}
              step={1}
              aria-label="Level"
              value={key}
              onChange={(e) => {
                const k = String(Math.trunc(e.target.valueAsNumber));
                if (!Number.isFinite(e.target.valueAsNumber) || (k !== key && k in value)) return;
                rebuild(entries.map(([ek, ev]) => (ek === key ? [k, ev] : [ek, ev])));
              }}
            />
          ) : (
            <Select
              id={i === 0 ? id : `${id}-${key}`}
              value={key}
              none={null}
              options={(keyRefs ?? [{ value: key, label: key }]).filter(
                (r) => r.value === key || !(r.value in value),
              )}
              onChange={(k) =>
                rebuild(entries.map(([ek, ev]) => (ek === key ? [k, ev] : [ek, ev])))
              }
            />
          )}
          <span className="muted">→</span>
          <Control
            id={`${id}-v-${key}`}
            name={`${name}:value`}
            schema={valueSchema}
            value={item}
            optional={false}
            onChange={(v) => rebuild(entries.map(([ek, ev]) => (ek === key ? [ek, v] : [ek, ev])))}
            ctx={ctx}
            parent={null}
          />
          <button
            type="button"
            className="icon"
            aria-label={`Remove ${key}`}
            disabled={entries.length <= minimum}
            onClick={() => rebuild(entries.filter(([ek]) => ek !== key))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        disabled={nextKey === null}
        onClick={() =>
          nextKey !== null &&
          rebuild([...entries, [nextKey, defaultFor(valueSchema, ctx.pick, `${name}:value`)]])
        }
      >
        + Add
      </button>
    </div>
  );
}
