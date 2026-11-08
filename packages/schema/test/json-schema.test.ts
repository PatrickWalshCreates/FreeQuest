// The emitted JSON Schema files must accept exactly what the TypeBox schemas
// accept, using a standard validator, so non-TypeScript tools can rely on them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';
import {
  DATABASE_KINDS,
  type FileKind,
  SCHEMAS,
  stableStringify,
  toJsonSchema,
} from '../src/index.js';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const DEMO = join(ROOT, 'samples', 'demo-project');
const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

const files: [FileKind, string][] = [
  ['manifest', 'project.json'],
  ['map', 'data/maps/map001.json'],
  ['tileset', 'data/tilesets/overworld.json'],
  ['character', 'data/characters/hero.json'],
  ...DATABASE_KINDS.map((kind): [FileKind, string] => [kind, `data/database/${kind}.json`]),
];

describe('emitted JSON Schema', () => {
  it.each(Object.keys(SCHEMAS) as FileKind[])('json/%s.schema.json is up to date', (kind) => {
    const onDisk = readFileSync(
      join(import.meta.dirname, '..', 'json', `${kind}.schema.json`),
      'utf8',
    );
    expect(onDisk, 'run `pnpm gen:schema`').toBe(stableStringify(toJsonSchema(SCHEMAS[kind])));
  });

  it.each(files)('validates the demo %s with ajv', (kind, path) => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(toJsonSchema(SCHEMAS[kind]));
    const data = read(join(DEMO, path));
    expect(validate(data), JSON.stringify(validate.errors)).toBe(true);
  });

  it('rejects an invalid nested command with ajv', () => {
    const ajv = new Ajv2020({ strict: false });
    const validate = ajv.compile(toJsonSchema(SCHEMAS.map));
    const map = read(join(DEMO, 'data/maps/map001.json')) as {
      events: { pages: { commands: unknown[] }[] }[];
    };
    map.events[0]?.pages[0]?.commands.push({
      type: 'if',
      conditions: [{ type: 'switch', switch: 'x', value: true }],
      then: [{ type: 'explode' }],
    });
    expect(validate(map)).toBe(false);
  });
});
