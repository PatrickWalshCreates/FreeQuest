// A macOS export: the prebuilt desktop player app ("the shell") copied
// under the game's name, with the game inside it. The caller signs the
// result afterwards (codesign needs the operating system).
import { type ExportPlan, type ExportProgress, type ExportResult, writeExport } from './export.js';
import type { OpenedProject } from './open-project.js';
import type { ProjectFs } from './project-fs.js';
import { EXPORT_MARKER, GAME_FOLDER, inspectTarget } from './web-export.js';

/** The shell as built by apps/player-desktop. */
export const MAC_SHELL_NAME = 'FreeQuest Player.app';

/** Where the game goes inside an app bundle. */
export const MAC_GAME_FOLDER = `Contents/Resources/${GAME_FOLDER}`;

/** A file name for the app: the game's name without characters macOS or zip tools dislike. */
export function macAppName(gameName: string, fallback: string): string {
  const cleaned = [...gameName]
    .map((c) => (c.charCodeAt(0) < 0x20 || '/\\:*?"<>|'.includes(c) ? '-' : c))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '');
  return `${cleaned || fallback}.app`;
}

/** A bundle identifier per game, so macOS keeps each exported game's settings apart. */
export function macBundleId(gameId: string): string {
  return `org.freequest.game.${gameId.replace(/_/g, '-')}`;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Set string values in an Info.plist (XML): replaces each key's existing
 * <string>, or adds the key at the end of the top-level dictionary.
 */
export function setPlistStrings(xml: string, values: Readonly<Record<string, string>>): string {
  let out = xml;
  for (const [key, value] of Object.entries(values)) {
    const entry = `<key>${key}</key>`;
    const existing = new RegExp(`(<key>${key}</key>\\s*)<string>[^<]*</string>`);
    const string = `<string>${escapeXml(value)}</string>`;
    if (existing.test(out)) {
      out = out.replace(existing, (_, prefix: string) => `${prefix}${string}`);
    } else {
      const end = out.lastIndexOf('</dict>');
      if (end === -1) throw new Error('Info.plist has no dictionary');
      out = `${out.slice(0, end)}\t${entry}\n\t${string}\n${out.slice(end)}`;
    }
  }
  return out;
}

/** Shell files that aren't copied: its placeholder game and its old code signature. */
function skipped(path: string): boolean {
  return (
    path === MAC_GAME_FOLDER ||
    path.startsWith(`${MAC_GAME_FOLDER}/`) ||
    path.startsWith('Contents/_CodeSignature/')
  );
}

export interface MacExportOptions {
  readonly project: OpenedProject;
  readonly plan: ExportPlan;
  /** The project folder (assets are copied from it). */
  readonly source: ProjectFs;
  /** The shell app bundle (rooted at "FreeQuest Player.app"). */
  readonly shell: ProjectFs;
  /** The output folder: must be empty. */
  readonly target: ProjectFs;
  readonly freequestVersion: string;
  readonly now?: Date;
  readonly onProgress?: (progress: ExportProgress) => void;
}

export interface MacExportResult extends ExportResult {
  /** The app bundle's path inside the output folder, e.g. "FreeQuest Demo.app". */
  readonly app: string;
}

/** Write "<Game>.app" into an empty folder. Sign it afterwards (see `macSignCommand`). */
export async function exportMac(options: MacExportOptions): Promise<MacExportResult> {
  const { project, plan, source, shell, target } = options;
  if ((await inspectTarget(target)).kind !== 'empty') {
    throw new Error('The export folder must be empty');
  }
  const manifest = project.manifest.data;
  const app = macAppName(manifest.name, manifest.id);
  const shellFiles = (await shell.list('')).filter((p) => !skipped(p));
  if (!shellFiles.includes('Contents/Info.plist')) {
    throw new Error('The desktop player app is incomplete (no Contents/Info.plist)');
  }
  const total = shellFiles.length + plan.files.length;
  let done = 0;
  let bytes = 0;
  for (const path of shellFiles) {
    if (path === 'Contents/Info.plist') {
      const xml = await shell.readText(path);
      const patched = setPlistStrings(xml, {
        CFBundleName: manifest.name,
        CFBundleDisplayName: manifest.name,
        CFBundleIdentifier: macBundleId(manifest.id),
      });
      await target.writeText(`${app}/${path}`, patched);
      bytes += patched.length;
    } else {
      const data = await shell.readBytes(path);
      await target.writeBytes(`${app}/${path}`, data, {
        executable: path.startsWith('Contents/MacOS/'),
      });
      bytes += data.length;
    }
    options.onProgress?.({ done: ++done, total, path });
  }
  const written = await writeExport(plan, source, target, {
    prefix: `${app}/${MAC_GAME_FOLDER}`,
    onProgress: (p) => options.onProgress?.({ done: done + p.done, total, path: p.path }),
  });
  await target.writeText(
    EXPORT_MARKER,
    `${JSON.stringify(
      {
        formatVersion: 1,
        target: 'mac',
        game: manifest.id,
        name: manifest.name,
        app,
        exportedAt: (options.now ?? new Date()).toISOString(),
        freequest: options.freequestVersion,
      },
      null,
      2,
    )}\n`,
  );
  return { app, files: written.files, bytes: bytes + written.bytes };
}

/**
 * The command that ad-hoc signs an exported app. Changing the bundle breaks
 * the shell's signature, and macOS refuses apps whose signature doesn't
 * match ("damaged"); ad-hoc signing makes it whole again. Players still see
 * "unidentified developer" until a real Developer ID signs it.
 */
export function macSignCommand(appPath: string): { command: string; args: string[] } {
  return { command: '/usr/bin/codesign', args: ['--force', '--deep', '--sign', '-', appPath] };
}
