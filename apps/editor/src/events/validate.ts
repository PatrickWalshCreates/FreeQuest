// Schema checks for values edited in dialogs, worded for people. Each value
// is checked against its own variant (not the whole union, whose errors list
// every variant that didn't match).
import {
  COMMAND_SCHEMAS,
  CONDITION_SCHEMA,
  type JsonSchema,
  fieldLabel,
  variantIndex,
} from '@freequest/editor-core';
import { Command } from '@freequest/schema';
import Value from 'typebox/value';

/** The definitions nested command lists point at, so a variant can be checked on its own. */
const DEFS = (Command as unknown as { $defs: unknown }).$defs;

function firstError(schema: JsonSchema, value: unknown): string | null {
  for (const error of Value.Errors({ ...schema, $defs: DEFS } as never, value)) {
    const where = error.instancePath
      .split('/')
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? `#${Number(part) + 1}` : fieldLabel(part)))
      .join(' › ');
    return `${where ? `${where}: ` : ''}${error.message}`;
  }
  return null;
}

export function commandProblem(value: unknown): string | null {
  const type = (value as { type?: unknown }).type;
  const schema = typeof type === 'string' ? COMMAND_SCHEMAS.get(type as never) : undefined;
  return schema ? firstError(schema, value) : 'Unknown command type';
}

export function conditionProblem(value: unknown): string | null {
  const variants = CONDITION_SCHEMA.anyOf ?? [];
  const schema = variants[variantIndex(variants, value)];
  return schema ? firstError(schema, value) : 'Unknown condition type';
}
