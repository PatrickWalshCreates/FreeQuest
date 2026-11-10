// Copies the built app to dist/macos/, where exporters look for the shell.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const built = fileURLToPath(
  new URL('../src-tauri/target/release/bundle/macos/FreeQuest Player.app', import.meta.url),
);
const staged = fileURLToPath(new URL('../dist/macos/FreeQuest Player.app', import.meta.url));
if (!existsSync(built)) throw new Error(`No built app at ${built}`);
rmSync(staged, { recursive: true, force: true });
cpSync(built, staged, { recursive: true, verbatimSymlinks: true });
console.log(`Staged the desktop player shell at ${staged}`);
