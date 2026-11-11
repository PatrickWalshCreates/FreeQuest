// `pnpm gen:notices`: the third-party licence notices that ship with
// FreeQuest. Each shipped thing gets a plain-text file: FreeQuest's own
// licence, then every package it includes (name, version, licence, where
// it's from), then each distinct licence text once, with the packages that
// use it. JavaScript packages come from `pnpm licenses`, Rust crates from
// `cargo metadata` (normal dependencies built into the app; build tools and
// proc-macros aren't shipped). Re-run before a release, or after changing
// dependencies.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The platforms desktop builds are made for (Rust dependencies differ per platform). */
const PLATFORMS = ['aarch64-apple-darwin', 'x86_64-apple-darwin'];

interface Dependency {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly source: string;
  /** The package's licence and notice files. */
  readonly texts: readonly string[];
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)/i;

/** Licence and notice files in a package folder, in name order. */
function licenseTexts(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && LICENSE_FILE.test(e.name))
    .map((e) => e.name)
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8').trim());
}

interface PnpmLicense {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  homepage?: string;
}

/** Production JavaScript packages of a workspace package and the workspace packages it uses (ours left out). */
function jsDependencies(workspacePackage: string): Dependency[] {
  // "name..." selects the package and every workspace package it depends on.
  const filter = `${workspacePackage}...`;
  const out = execFileSync('pnpm', ['licenses', 'list', '--prod', '--json', '--filter', filter], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const byLicense = JSON.parse(out) as Record<string, PnpmLicense[]>;
  return Object.values(byLicense)
    .flat()
    .filter((p) => !p.name.startsWith('@freequest/'))
    .flatMap((p) =>
      p.versions.map((version, i) => ({
        name: p.name,
        version,
        license: p.license,
        source: p.homepage ?? `https://www.npmjs.com/package/${p.name}`,
        texts: licenseTexts(p.paths[i] ?? p.paths[0] ?? ''),
      })),
    );
}

interface CargoPackage {
  id: string;
  name: string;
  version: string;
  license: string | null;
  repository: string | null;
  manifest_path: string;
  targets: { kind: string[] }[];
}
interface CargoNode {
  id: string;
  deps: { pkg: string; dep_kinds: { kind: string | null }[] }[];
}

/** Rust crates built into a Tauri app for the release platforms (its own crate left out). */
function rustDependencies(manifest: string): Dependency[] {
  const found = new Map<string, Dependency>();
  for (const platform of PLATFORMS) {
    const out = execFileSync(
      'cargo',
      [
        'metadata',
        '--format-version',
        '1',
        '--manifest-path',
        manifest,
        '--filter-platform',
        platform,
      ],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 },
    );
    const meta = JSON.parse(out) as {
      packages: CargoPackage[];
      resolve: { root: string; nodes: CargoNode[] };
    };
    const packages = new Map(meta.packages.map((p) => [p.id, p]));
    const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]));
    const shipped = (id: string) =>
      !(packages.get(id)?.targets.every((t) => t.kind.includes('proc-macro')) ?? false);
    // Walk normal dependencies only: build-dependencies and proc-macros run at compile time.
    const seen = new Set<string>();
    const stack = [meta.resolve.root];
    while (stack.length > 0) {
      const id = stack.pop() ?? '';
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dep of nodes.get(id)?.deps ?? []) {
        if (dep.dep_kinds.some((k) => k.kind === null) && shipped(dep.pkg)) stack.push(dep.pkg);
      }
    }
    seen.delete(meta.resolve.root);
    for (const id of seen) {
      const p = packages.get(id);
      if (!p || found.has(`${p.name}@${p.version}`)) continue;
      found.set(`${p.name}@${p.version}`, {
        name: p.name,
        version: p.version,
        license: p.license ?? 'see its licence file',
        source: p.repository ?? `https://crates.io/crates/${p.name}`,
        texts: licenseTexts(dirname(p.manifest_path)),
      });
    }
  }
  return [...found.values()];
}

const freequestLicense = readFileSync(join(ROOT, 'LICENSE'), 'utf8').trim();
const version = (
  JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

function notices(title: string, dependencies: readonly Dependency[]): string {
  const sorted = [...dependencies].sort(
    (a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
  );
  const lines: string[] = [
    `${title} ${version}`,
    '',
    'FreeQuest is free software under the MIT License:',
    '',
    freequestLicense,
    '',
    '='.repeat(72),
    '',
    `It includes the following ${sorted.length} third-party packages:`,
    '',
    ...sorted.map((d) => `- ${d.name} ${d.version} (${d.license}): ${d.source}`),
    '',
  ];
  // Each distinct licence text once (whitespace aside), with every package that ships it.
  const texts = new Map<string, { text: string; users: string[] }>();
  for (const d of sorted) {
    const own =
      d.texts.length > 0
        ? d.texts
        : [`(No licence file in the package; its licence is ${d.license}.)`];
    for (const text of own) {
      const key = text.replace(/\s+/g, ' ');
      const entry = texts.get(key) ?? { text, users: [] };
      const user = `${d.name} ${d.version}`;
      if (!entry.users.includes(user)) entry.users.push(user);
      texts.set(key, entry);
    }
  }
  for (const { text, users } of texts.values()) {
    lines.push('='.repeat(72), '', `Used by: ${users.join(', ')}`, '', text, '');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function write(path: string, text: string): void {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, text);
  console.log(`wrote ${path} (${Math.round(text.length / 1024)} KB)`);
}

const playerJs = jsDependencies('@freequest/player');
write(
  'packages/player/public/THIRD_PARTY_NOTICES.txt',
  notices('FreeQuest Player (in exported games)', playerJs),
);
write(
  'apps/player-desktop/THIRD_PARTY_NOTICES.txt',
  notices('FreeQuest Player for macOS', [
    ...playerJs,
    ...rustDependencies('apps/player-desktop/src-tauri/Cargo.toml'),
  ]),
);
write(
  'apps/editor/public/THIRD_PARTY_NOTICES.txt',
  notices('FreeQuest Editor', [
    ...jsDependencies('@freequest/editor'),
    ...rustDependencies('apps/editor/src-tauri/Cargo.toml'),
  ]),
);
