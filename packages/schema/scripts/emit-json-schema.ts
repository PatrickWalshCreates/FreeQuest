// Writes json/<kind>.schema.json from the TypeBox definitions, so editors and
// external tools can validate FreeQuest files without TypeScript.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMAS, stableStringify } from '../src/index.js';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'json');
mkdirSync(outDir, { recursive: true });

for (const [kind, schema] of Object.entries(SCHEMAS)) {
  const file = join(outDir, `${kind}.schema.json`);
  const doc = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...schema };
  writeFileSync(file, stableStringify(JSON.parse(JSON.stringify(doc))));
  console.log(`wrote ${file}`);
}
