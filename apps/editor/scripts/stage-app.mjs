// Copies the built editor app to dist-app/ and signs it ad-hoc, so macOS
// accepts the whole bundle (with the player app inside it) as one piece.
// Without a Developer ID it's still an "unidentified developer" app: open it
// with right-click > Open the first time.
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = 'FreeQuest Editor.app';
const built = fileURLToPath(
  new URL(`../src-tauri/target/release/bundle/macos/${APP}`, import.meta.url),
);
const staged = fileURLToPath(new URL(`../dist-app/macos/${APP}`, import.meta.url));
if (!existsSync(built)) throw new Error(`No built app at ${built}`);
rmSync(staged, { recursive: true, force: true });
cpSync(built, staged, { recursive: true, verbatimSymlinks: true });
if (process.platform === 'darwin') {
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', staged], {
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged], {
    stdio: 'inherit',
  });
}
console.log(`FreeQuest Editor is at ${staged}`);
