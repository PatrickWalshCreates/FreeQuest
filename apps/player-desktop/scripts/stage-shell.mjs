// Copies the built Mac app to dist/macos/, where exporters and the editor's
// build look for it (apps/editor/scripts/stage-players.mjs bundles it).
import { cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { builtMacApp } from '../../../scripts/mac-bundles.mjs';

const APP = 'FreeQuest Player.app';
const built = builtMacApp(fileURLToPath(new URL('../src-tauri', import.meta.url)), APP);
const copies = [fileURLToPath(new URL(`../dist/macos/${APP}`, import.meta.url))];
if (!built) throw new Error(`No built ${APP}: run the build first`);
for (const copy of copies) {
  rmSync(copy, { recursive: true, force: true });
  cpSync(built, copy, { recursive: true, verbatimSymlinks: true });
  console.log(`Staged the desktop player shell at ${copy}`);
}
