// Writes json/<kind>.schema.json from the TypeBox definitions, so editors and
// external tools can validate FreeQuest files without TypeScript.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMAS, stableStringify, toJsonSchema } from '../src/index.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');
mkdirSync(outDir, { recursive: true });

for (const [kind, schema] of Object.entries(SCHEMAS)) {
  const file = join(outDir, `${kind}.schema.json`);
  writeFileSync(file, stableStringify(toJsonSchema(schema)));
  console.log(`wrote ${file}`);
}
