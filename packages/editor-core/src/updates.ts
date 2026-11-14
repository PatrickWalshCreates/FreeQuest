// Updates for the desktop editor. Each GitHub release carries a small
// manifest, `latest.json`, naming the version and, per system, the file to
// download and its signature (made with FreeQuest's own update key; the
// editor refuses files the key didn't sign). The editor checks the latest
// release's manifest at start and offers the update; this file holds the
// pure parts: comparing versions, remembering a skipped version, the
// release notes for a version, and building the manifest at release time.

/** Where the desktop editor looks for updates (the newest published release, never a draft). */
export const UPDATE_MANIFEST_URL =
  'https://github.com/PatrickWalshCreates/FreeQuest/releases/latest/download/latest.json';

/** Storage key for the version the user chose to skip. */
export const SKIPPED_UPDATE_KEY = 'freequest:editor:skipped-update';

/**
 * Compare two versions like 0.3.0 or 0.4.0-test.1: negative when `a` is
 * older. Numbers compare numerically; a version with a suffix ("-test.1")
 * comes before the same version without one.
 */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => {
    const [core = '', pre = ''] = v.trim().replace(/^v/, '').split('-', 2);
    return { parts: core.split('.').map((n) => Number.parseInt(n, 10) || 0), pre };
  };
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < Math.max(x.parts.length, y.parts.length); i++) {
    const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre === '') return 1;
  if (y.pre === '') return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** Whether to offer `available`: newer than what runs, and not the version the user skipped. */
export function shouldOfferUpdate(
  current: string,
  available: string,
  skipped: string | null,
): boolean {
  return compareVersions(available, current) > 0 && available !== skipped;
}

/**
 * One version's section of CHANGELOG.md (the text under its "## <version>"
 * heading, up to the next one), trimmed; null when it has none.
 */
export function changelogSection(changelog: string, version: string): string | null {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => new RegExp(`^## ${escape(version)}(\\s|$)`).test(line));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const text = (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
  return text === '' ? null : text;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The update systems, keyed as the updater names them, and the release file each one gets. */
export const UPDATE_FILES = {
  'darwin-aarch64': (version: string) =>
    `FreeQuest-Editor-${version}-macOS-AppleSilicon.app.tar.gz`,
  'darwin-x86_64': (version: string) => `FreeQuest-Editor-${version}-macOS-Intel.app.tar.gz`,
  'windows-x86_64': (version: string) => `FreeQuest-Editor-${version}-Windows-setup.exe`,
  'linux-x86_64': (version: string) => `FreeQuest-Editor-${version}-Linux-x86_64.AppImage`,
  // A .deb install updates from the .deb (the updater tries '<system>-<installer>' first).
  'linux-x86_64-deb': (version: string) => `FreeQuest-Editor-${version}-Linux-amd64.deb`,
} as const;

export type UpdatePlatform = keyof typeof UPDATE_FILES;

export interface UpdateManifest {
  readonly version: string;
  readonly notes: string;
  readonly pub_date: string;
  readonly platforms: Readonly<
    Record<string, { readonly signature: string; readonly url: string }>
  >;
}

/**
 * The release's latest.json. `signatures` holds each system's signature
 * (the text of its .sig file); systems without one are left out, so a
 * release missing a build still updates the others.
 */
export function updateManifest(options: {
  readonly version: string;
  readonly notes: string;
  readonly date: Date;
  /** Base of the release's download links, e.g. https://github.com/<repo>/releases/download/v0.3.0 */
  readonly downloadBase: string;
  readonly signatures: Partial<Record<UpdatePlatform, string>>;
}): UpdateManifest {
  const platforms: Record<string, { signature: string; url: string }> = {};
  for (const platform of Object.keys(UPDATE_FILES) as UpdatePlatform[]) {
    const signature = options.signatures[platform]?.trim();
    if (!signature) continue;
    platforms[platform] = {
      signature,
      url: `${options.downloadBase.replace(/\/$/, '')}/${UPDATE_FILES[platform](options.version)}`,
    };
  }
  return {
    version: options.version,
    notes: options.notes,
    pub_date: options.date.toISOString(),
    platforms,
  };
}
