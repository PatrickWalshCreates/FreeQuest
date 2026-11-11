// Bundles the desktop players with the editor, so it can export games for
// macOS, Windows and Linux: copies apps/player-desktop/dist/<system>/ (each
// one that has been built: macOS here, Windows and Linux by the release
// workflow) into src-tauri/players/, which tauri.conf.json bundles as a
// resource. Run before every desktop build of the editor (the scripts do).
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SYSTEMS = ['macos', 'windows', 'linux'];
const source = fileURLToPath(new URL('../../player-desktop/dist/', import.meta.url));
const target = fileURLToPath(new URL('../src-tauri/players/', import.meta.url));
// Tauri copies resources only when they change, so a dev build's copy is refreshed too.
const devCopy = fileURLToPath(new URL('../src-tauri/target/debug/players/', import.meta.url));

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
// Never empty, so the resource always exists.
writeFileSync(
  join(target, 'README.txt'),
  'Desktop players bundled with FreeQuest Editor, used to export games. Made by scripts/stage-players.mjs.\n',
);
const staged = [];
for (const system of SYSTEMS) {
  const from = join(source, system);
  if (!existsSync(from)) continue;
  cpSync(from, join(target, system), { recursive: true, verbatimSymlinks: true });
  staged.push(system);
}
if (existsSync(devCopy)) {
  rmSync(devCopy, { recursive: true, force: true });
  cpSync(target, devCopy, { recursive: true, verbatimSymlinks: true });
}
console.log(
  staged.length > 0
    ? `Bundling the desktop players for: ${staged.join(', ')}`
    : 'No desktop players built yet: this editor will only export web games.',
);
