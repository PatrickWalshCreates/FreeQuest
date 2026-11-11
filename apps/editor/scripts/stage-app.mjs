// Copies the built editor app to dist-app/ and signs it ad-hoc, so macOS
// accepts the whole bundle (with the player app inside it) as one piece,
// then packs it into a disk image (.dmg) to download.
// Without a Developer ID it's still an "unidentified developer" app: open it
// with right-click > Open the first time.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtMacApp } from '../../../scripts/mac-bundles.mjs';

const APP = 'FreeQuest Editor.app';
const built = builtMacApp(fileURLToPath(new URL('../src-tauri', import.meta.url)), APP);
const out = fileURLToPath(new URL('../dist-app/macos/', import.meta.url));
const staged = join(out, APP);
if (!built) throw new Error(`No built ${APP}: run the build first`);
rmSync(staged, { recursive: true, force: true });
cpSync(built, staged, { recursive: true, verbatimSymlinks: true });
if (process.platform === 'darwin') {
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', staged], {
    stdio: 'inherit',
  });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staged], {
    stdio: 'inherit',
  });
  // A disk image to download: the signed app and a shortcut to Applications to drag it onto.
  const version = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ).version;
  const dmg = join(out, `FreeQuest-Editor-${version}-macOS.dmg`);
  const root = join(out, '.dmg-root');
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  cpSync(staged, join(root, APP), { recursive: true, verbatimSymlinks: true });
  symlinkSync('/Applications', join(root, 'Applications'));
  rmSync(dmg, { force: true });
  execFileSync(
    '/usr/bin/hdiutil',
    ['create', '-volname', 'FreeQuest Editor', '-srcfolder', root, '-format', 'UDZO', '-ov', dmg],
    { stdio: 'inherit' },
  );
  rmSync(root, { recursive: true, force: true });
  console.log(`Disk image: ${dmg}`);
}
console.log(`FreeQuest Editor is at ${staged}`);
