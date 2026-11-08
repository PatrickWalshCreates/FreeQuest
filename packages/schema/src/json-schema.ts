import type { TSchema } from 'typebox';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/**
 * Convert a TypeBox schema to a standalone JSON Schema (draft 2020-12).
 *
 * TypeBox writes recursive types as nested `{ $defs, $ref: "Name" }` nodes,
 * which generic validators can't resolve. This hoists every `$defs` to the
 * root and rewrites references to the standard `#/$defs/Name` form.
 */
export function toJsonSchema(schema: TSchema): Record<string, Json> {
  const defs: Record<string, Json> = {};

  const visit = (node: Json): Json => {
    if (Array.isArray(node)) return node.map(visit);
    if (node === null || typeof node !== 'object') return node;
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === '$defs' && value && typeof value === 'object' && !Array.isArray(value)) {
        for (const [name, def] of Object.entries(value)) {
          // TypeBox tags definitions with `$id: name`, which would make
          // `#/$defs/...` inside them resolve against the definition itself.
          const hoisted = visit(def);
          if (hoisted && typeof hoisted === 'object' && !Array.isArray(hoisted)) {
            delete hoisted['$id'];
          }
          if (name in defs && JSON.stringify(defs[name]) !== JSON.stringify(hoisted)) {
            throw new Error(`conflicting definitions for "${name}"`);
          }
          defs[name] = hoisted;
        }
      } else if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
        out[key] = `#/$defs/${value}`;
      } else {
        out[key] = visit(value);
      }
    }
    return out;
  };

  const root = visit(JSON.parse(JSON.stringify(schema)) as Json) as Record<string, Json>;
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...root,
    ...(Object.keys(defs).length > 0 ? { $defs: defs } : {}),
  };
}
