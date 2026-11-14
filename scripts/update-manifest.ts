// Writes latest.json, the editor's update manifest, for a release: the
// version, its notes from CHANGELOG.md, and each system's download with the
// signature the release workflow made for it (<file>.sig beside the file).
// Usage: tsx scripts/update-manifest.ts <downloads folder> [download base URL]
// The base defaults to this repository's release for the current version.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  UPDATE_FILES,
  type UpdatePlatform,
  changelogSection,
  updateManifest,
} from '../packages/editor-core/src/updates.js';

const [folder, base] = process.argv.slice(2);
if (!folder) {
  console.error('Usage: tsx scripts/update-manifest.ts <downloads folder> [download base URL]');
  process.exit(2);
}
const root = new URL('..', import.meta.url);
const version = (
  JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as { version: string }
).version;
const repo = process.env['GITHUB_REPOSITORY'] ?? 'PatrickWalshCreates/FreeQuest';
const notes =
  changelogSection(readFileSync(new URL('CHANGELOG.md', root), 'utf8'), version) ??
  `FreeQuest ${version}. See CHANGELOG.md for what's new.`;

const signatures: Partial<Record<UpdatePlatform, string>> = {};
for (const platform of Object.keys(UPDATE_FILES) as UpdatePlatform[]) {
  const sig = join(folder, `${UPDATE_FILES[platform](version)}.sig`);
  if (existsSync(sig)) signatures[platform] = readFileSync(sig, 'utf8');
  else console.warn(`No update for ${platform}: ${sig} is missing`);
}
if (Object.keys(signatures).length === 0) {
  console.error('No signed update files: is TAURI_SIGNING_PRIVATE_KEY set in the workflow?');
  process.exit(1);
}
const manifest = updateManifest({
  version,
  notes,
  date: new Date(),
  downloadBase: base ?? `https://github.com/${repo}/releases/download/v${version}`,
  signatures,
});
writeFileSync(join(folder, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${join(folder, 'latest.json')} for ${Object.keys(signatures).join(', ')}`);
