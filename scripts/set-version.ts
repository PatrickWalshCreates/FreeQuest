// `pnpm version:set [version]`: set FreeQuest's version (in the root
// package.json) and write it into every other versioned file. Without an
// argument it re-syncs the files from the root package.json.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_PATTERN, VERSION_SOURCE, sourceVersion, versionedFiles } from './version-files.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wanted = process.argv[2];

if (wanted !== undefined) {
  if (!VERSION_PATTERN.test(wanted)) {
    console.error(`"${wanted}" isn't a version like 0.1.0 or 0.2.0-beta.1`);
    process.exit(2);
  }
  const path = join(root, VERSION_SOURCE);
  const text = readFileSync(path, 'utf8');
  writeFileSync(path, text.replace(/"version": "[^"]*"/, `"version": "${wanted}"`));
}

const version = sourceVersion(root);
let changed = 0;
for (const file of versionedFiles(root)) {
  const path = join(root, file.path);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const after = file.write(before, version);
  if (after === before) continue;
  if (file.read(after) !== version) throw new Error(`couldn't write the version into ${file.path}`);
  writeFileSync(path, after);
  changed++;
  console.log(`${file.path} → ${version}`);
}
console.log(
  `FreeQuest ${version}: ${changed === 0 ? 'every file already had it' : `${changed} files updated`}.`,
);
