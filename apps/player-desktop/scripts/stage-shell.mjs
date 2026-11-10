// Copies the built app to dist/macos/, where exporters look for the shell.
// Also refreshes the copy a dev build of the editor bundles, which Tauri
// doesn't recopy on its own when only the shell changed.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = 'FreeQuest Player.app';
const built = fileURLToPath(
  new URL(`../src-tauri/target/release/bundle/macos/${APP}`, import.meta.url),
);
const copies = [
  fileURLToPath(new URL(`../dist/macos/${APP}`, import.meta.url)),
  // Only when the editor has been run with `pnpm editor:desktop` before.
  fileURLToPath(new URL(`../../editor/src-tauri/target/debug/mac-player/${APP}`, import.meta.url)),
];
if (!existsSync(built)) throw new Error(`No built app at ${built}`);
for (const [i, copy] of copies.entries()) {
  if (i > 0 && !existsSync(copy)) continue;
  rmSync(copy, { recursive: true, force: true });
  cpSync(built, copy, { recursive: true, verbatimSymlinks: true });
  console.log(`Staged the desktop player shell at ${copy}`);
}
