// Where Tauri put a built macOS app: the universal build if there is one,
// else the build for this Mac, whichever is newer.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The newest built `<name>.app` under a Tauri project's target folder, or null. */
export function builtMacApp(srcTauri, name) {
  const targets = ['universal-apple-darwin', 'aarch64-apple-darwin', 'x86_64-apple-darwin'];
  const candidates = [
    ...targets.map((t) => join(srcTauri, 'target', t, 'release', 'bundle', 'macos', name)),
    join(srcTauri, 'target', 'release', 'bundle', 'macos', name),
  ].filter((path) => existsSync(path));
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0] ?? null;
}
