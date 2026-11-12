// Reading TypeBox schemas (plain JSON Schema objects) to build editor forms:
// what kind of control a field needs, sensible defaults, and which variant
// of a union a value is. The UI renders from this; nothing here is React.
import { Command, type CommandType, Condition } from '@freequest/schema';

/** The parts of JSON Schema the project format uses. */
export interface JsonSchema {
  readonly type?: string;
  readonly const?: unknown;
  readonly anyOf?: readonly JsonSchema[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly minLength?: number;
  readonly minItems?: number;
  readonly pattern?: string;
  readonly description?: string;
  readonly title?: string;
  readonly $ref?: string;
  readonly patternProperties?: Readonly<Record<string, JsonSchema>>;
  readonly minProperties?: number;
}

export type Primitive = string | number | boolean | null;

export type FieldShape =
  /** A fixed value (e.g. a union's `type` discriminator): nothing to edit. */
  | { readonly kind: 'fixed'; readonly value: unknown }
  /** One of a few literal values: a dropdown. */
  | { readonly kind: 'choice'; readonly options: readonly Primitive[] }
  /** `X | null`, e.g. "stop the music". */
  | { readonly kind: 'nullable'; readonly inner: JsonSchema }
  /** Any other union: pick a variant, then edit it. */
  | { readonly kind: 'union'; readonly variants: readonly JsonSchema[] }
  | { readonly kind: 'string' | 'number' | 'integer' | 'boolean'; readonly schema: JsonSchema }
  | { readonly kind: 'object'; readonly schema: JsonSchema }
  | { readonly kind: 'array'; readonly schema: JsonSchema; readonly item: JsonSchema }
  /** A map from keys to values, e.g. a level curve (level → value) or slot → equipment. */
  | {
      readonly kind: 'record';
      readonly schema: JsonSchema;
      /** Integer keys (levels) sort numerically; string keys are free (or a reference). */
      readonly keys: 'integer' | 'string';
      readonly value: JsonSchema;
    }
  /** A reference to a recursive type (nested command lists): edited elsewhere. */
  | { readonly kind: 'ref'; readonly name: string };

export function asSchema(schema: unknown): JsonSchema {
  return schema as JsonSchema;
}

/** Which control a schema needs. */
export function classify(schema: JsonSchema): FieldShape {
  if (schema.const !== undefined) return { kind: 'fixed', value: schema.const };
  if (schema.$ref !== undefined) return { kind: 'ref', name: schema.$ref };
  const anyOf = schema.anyOf;
  if (anyOf) {
    if (anyOf.every((v) => v.const !== undefined)) {
      return { kind: 'choice', options: anyOf.map((v) => v.const as Primitive) };
    }
    const nonNull = anyOf.filter((v) => v.type !== 'null');
    const [only] = nonNull;
    if (only && nonNull.length === 1 && anyOf.length === 2)
      return { kind: 'nullable', inner: only };
    return { kind: 'union', variants: anyOf };
  }
  switch (schema.type) {
    case 'string':
    case 'number':
    case 'integer':
    case 'boolean':
      return { kind: schema.type, schema };
    case 'array':
      return { kind: 'array', schema, item: schema.items ?? {} };
    default: {
      const [pattern, value] = Object.entries(schema.patternProperties ?? {})[0] ?? [];
      if (pattern !== undefined && value) {
        return { kind: 'record', schema, keys: /0-9/.test(pattern) ? 'integer' : 'string', value };
      }
      return { kind: 'object', schema };
    }
  }
}

/** Object properties in schema order, with whether each is required. */
export function fieldsOf(
  schema: JsonSchema,
): { name: string; schema: JsonSchema; required: boolean }[] {
  const required = new Set(schema.required ?? []);
  return Object.entries(schema.properties ?? {}).map(([name, s]) => ({
    name,
    schema: s,
    required: required.has(name),
  }));
}

/** Does `value` have the shape of `schema`? Shallow: enough to tell union variants apart. */
export function matches(schema: JsonSchema, value: unknown): boolean {
  if (schema.const !== undefined) return value === schema.const;
  if (schema.anyOf) return schema.anyOf.some((v) => matches(v, value));
  switch (schema.type) {
    case 'null':
      return value === null;
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number';
    case 'integer':
      return Number.isInteger(value);
    case 'array':
      return Array.isArray(value);
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
      const record = value as Record<string, unknown>;
      // Discriminators (const properties) must agree; required keys must be present.
      return fieldsOf(schema).every(
        (f) =>
          (f.schema.const === undefined || record[f.name] === f.schema.const) &&
          (!f.required || f.name in record),
      );
    }
    default:
      return true;
  }
}

/** Index of the variant `value` belongs to (0 when none fits, so the form can repair it). */
export function variantIndex(variants: readonly JsonSchema[], value: unknown): number {
  const index = variants.findIndex((v) => matches(v, value));
  return index === -1 ? 0 : index;
}

/** A name for a union variant: its `type` discriminator, title, or JSON type. */
export function variantLabel(schema: JsonSchema): string {
  const type = schema.properties?.['type'];
  const discriminator = type?.const;
  if (typeof discriminator === 'string') return discriminator;
  // A variant covering several type values, e.g. hitRate / evasionRate / criticalRate.
  if (type?.anyOf?.every((v) => typeof v.const === 'string')) {
    return type.anyOf.map((v) => v.const as string).join(' / ');
  }
  if (schema.title) return schema.title;
  if (schema.type === 'object') {
    // Told apart by other fixed values, e.g. a target's side and selection.
    const parts = fieldsOf(schema).flatMap((f) => {
      if (typeof f.schema.const === 'string') return [f.schema.const];
      const choices = f.schema.anyOf?.map((v) => v.const);
      return choices?.every((c) => typeof c === 'string') ? [choices.join(' / ')] : [];
    });
    if (parts.length > 0) return parts.join(' · ');
    const [first] = fieldsOf(schema);
    if (first) return first.name;
  }
  return schema.type ?? 'value';
}

/** "canEscape" → "Can escape". */
export function fieldLabel(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Supplies a starting value for a text field that refers to something
 * (the first switch, the first map, …). Return undefined for "no opinion".
 * Lists of references ask once per item, with the list's field name.
 * Number and boolean fields ask too (e.g. a success rate that should start at 1).
 */
export type DefaultPicker = (field: string, schema: JsonSchema) => unknown;

/** A valid-as-possible starting value for a schema (required fields only). */
export function defaultFor(
  schema: JsonSchema,
  pick: DefaultPicker = () => undefined,
  field = '',
): unknown {
  const shape = classify(schema);
  switch (shape.kind) {
    case 'fixed':
      return shape.value;
    case 'choice':
      return shape.options[0] ?? null;
    case 'nullable':
      return defaultFor(shape.inner, pick, field);
    case 'union':
      return shape.variants[0] ? defaultFor(shape.variants[0], pick, field) : null;
    case 'string': {
      // References (the first switch, the first map…) come from the picker.
      const picked = pick(field, schema);
      if (picked !== undefined) return picked;
      return schema.minLength ? 'x'.repeat(schema.minLength) : '';
    }
    case 'boolean': {
      const picked = pick(field, schema);
      return typeof picked === 'boolean' ? picked : false;
    }
    case 'number':
    case 'integer': {
      const picked = pick(field, schema);
      if (typeof picked === 'number') return picked;
      // The smallest allowed value (e.g. 1 for "more than 0"), else 0.
      return (
        schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 0)
      );
    }
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () =>
        defaultFor(shape.item, pick, field),
      );
    case 'ref':
      return [];
    case 'record':
      return (schema.minProperties ?? 0) > 0
        ? { [shape.keys === 'integer' ? '1' : '']: defaultFor(shape.value, pick, field) }
        : {};
    case 'object':
      return Object.fromEntries(
        fieldsOf(schema)
          .filter((f) => f.required)
          .map((f) => [f.name, defaultFor(f.schema, pick, f.name)]),
      );
  }
}

/**
 * True when a command type has something to fill in: a field other than its
 * `type` and the command lists it holds (which the tree editor fills).
 * Loop, Break loop and Exit event don't, so the editor adds them at once.
 */
export function commandHasFields(type: CommandType): boolean {
  const props = COMMAND_SCHEMAS.get(type)?.properties ?? {};
  return Object.entries(props).some(([name, schema]) => {
    if (name === 'type') return false;
    const shape = classify(schema);
    return !(shape.kind === 'array' && classify(shape.item).kind === 'ref');
  });
}

/** The schema of each command type, for building command forms. */
export const COMMAND_SCHEMAS: ReadonlyMap<CommandType, JsonSchema> = new Map(
  (asSchema(Command) as { $defs?: Record<string, JsonSchema> }).$defs?.['Command']?.anyOf?.map(
    (variant) => [variant.properties?.['type']?.const as CommandType, variant] as const,
  ) ?? [],
);

/** The union of condition types. */
export const CONDITION_SCHEMA: JsonSchema = asSchema(Condition);
