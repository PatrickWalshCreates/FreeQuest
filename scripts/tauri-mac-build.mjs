// Builds a Tauri app for macOS: universal (Apple Silicon + Intel) when a
// rustup toolchain with both targets is available, otherwise for this Mac
// only (with a warning). Usage, from an app folder:
//   node ../../scripts/tauri-mac-build.mjs
// FREEQUEST_MAC_TARGET=aarch64-apple-darwin or x86_64-apple-darwin builds for
// one kind of Mac instead (the release's separate editor downloads).
// Homebrew's Rust can't add targets, so we look for rustup (Homebrew's
// keg-only `rustup` formula, or ~/.cargo/bin) and put it first on PATH for
// this build only.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

const TARGETS = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];

function rustupBin() {
  const candidates = [process.env.FREEQUEST_RUSTUP_BIN, join(homedir(), '.cargo', 'bin')];
  try {
    const prefix = execFileSync('brew', ['--prefix', 'rustup'], { encoding: 'utf8' }).trim();
    candidates.push(join(prefix, 'bin'));
  } catch {
    // No Homebrew, or no rustup formula.
  }
  return candidates.find((dir) => dir && existsSync(join(dir, 'rustup'))) ?? null;
}

function universalReady(bin) {
  try {
    const installed = execFileSync(join(bin, 'rustup'), ['target', 'list', '--installed'], {
      encoding: 'utf8',
    });
    return TARGETS.every((t) => installed.split('\n').includes(t));
  } catch {
    return false;
  }
}

const only = process.env.FREEQUEST_MAC_TARGET;
if (only && !TARGETS.includes(only)) {
  console.error(`FREEQUEST_MAC_TARGET must be one of ${TARGETS.join(', ')}, not "${only}"`);
  process.exit(2);
}
const bin = process.platform === 'darwin' ? rustupBin() : null;
const universal = bin !== null && universalReady(bin);
const env = { ...process.env };
if (universal) env.PATH = `${bin}${delimiter}${env.PATH ?? ''}`;
else if (process.platform === 'darwin' && !only) {
  console.warn(
    'Building for this Mac only. For a universal app (Apple Silicon and Intel), install rustup ' +
      '(brew install rustup) and run: rustup target add aarch64-apple-darwin x86_64-apple-darwin',
  );
}

const args = [
  'tauri',
  'build',
  '--bundles',
  'app',
  ...(only ? ['--target', only] : universal ? ['--target', 'universal-apple-darwin'] : []),
];
const result = spawnSync('pnpm', args, { stdio: 'inherit', env });
process.exit(result.status ?? 1);
