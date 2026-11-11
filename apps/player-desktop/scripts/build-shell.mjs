// `pnpm build:mac-player` / `build:shell`: build the desktop player for the
// system this runs on and stage it in dist/<system>/, where exporters and
// the editor's build look for it:
//   macOS   → dist/macos/FreeQuest Player.app (universal when rustup allows)
//   Windows → dist/windows/freequest-player.exe + THIRD_PARTY_NOTICES.txt
//   Linux   → dist/linux/freequest-player + THIRD_PARTY_NOTICES.txt
// Windows and Linux exports use the plain program (no installer): it finds
// the game in a game/ folder next to it.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    cwd: here('..'),
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (process.platform === 'darwin') {
  run('node', [here('../../../scripts/tauri-mac-build.mjs')]);
  run('node', [here('./stage-shell.mjs')]);
} else {
  const system = process.platform === 'win32' ? 'windows' : 'linux';
  const program = system === 'windows' ? 'freequest-player.exe' : 'freequest-player';
  run('pnpm', ['tauri', 'build', '--no-bundle']);
  const out = here(`../dist/${system}`);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  copyFileSync(here(`../src-tauri/target/release/${program}`), `${out}/${program}`);
  if (system === 'linux') chmodSync(`${out}/${program}`, 0o755);
  copyFileSync(here('../THIRD_PARTY_NOTICES.txt'), `${out}/THIRD_PARTY_NOTICES.txt`);
  console.log(`Staged the ${system} player at ${out}`);
}
