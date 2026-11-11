// The freequest command. `run` takes arguments and an Io so tests can drive
// it without a terminal; main.ts wires it to the real process.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseArgs } from 'node:util';
import {
  EXPORT_MARKER,
  type OpenedProject,
  type PlayerFiles,
  type Problem,
  MAC_SHELL_NAME,
  ProjectOpenError,
  clearExport,
  type DesktopTarget,
  DESKTOP_TARGET_NAMES,
  exportDesktop,
  exportMac,
  exportWeb,
  desktopShellProblem,
  macSignCommand,
  inspectTarget,
  openProject,
  planExport,
} from '@freequest/editor-core';
import { FREEQUEST_VERSION } from '@freequest/schema';
import { NodeFs } from './node-fs.js';

export interface Io {
  out(line: string): void;
  err(line: string): void;
  readonly cwd: string;
  /** Where the built release player is (default: the @freequest/player package's dist/). */
  readonly playerDir?: string;
  /** The desktop player app to export Mac apps from (default: the repo's staged shell). */
  readonly macShell?: string;
  /** The Windows and Linux player folders (tests replace them). */
  readonly desktopShells?: Partial<Record<DesktopTarget, string>>;
  /** Runs codesign (tests replace it). */
  readonly sign?: SignRunner;
  /** Overrides process.platform (tests). */
  readonly platform?: string;
}

/** FreeQuest's one version (from the root package.json). */
export const VERSION = FREEQUEST_VERSION;

/** Marks a folder as a FreeQuest export, so `--clean` only ever deletes exports. */
export { EXPORT_MARKER };

const HELP = `freequest ${VERSION}: check and export FreeQuest projects

Usage:
  freequest check [project]               Report every problem in a project
  freequest export web [project] --out <folder> [--clean]
                                          Export a game for the web (any static host)
  freequest export mac [project] --out <folder> [--clean] [--shell <app>]
                                          Export a macOS app (signed ad-hoc on a Mac)
  freequest export windows|linux [project] --out <folder> [--clean] [--shell <folder>]
                                          Export a Windows or Linux game (a folder to zip)

[project] is the folder containing project.json (default: the current folder).
--clean replaces a previous export in the output folder; other folders must be empty.
--shell is the desktop player to build from (default: the one staged by
"pnpm build:mac-player" for Mac, or apps/player-desktop/dist/windows|linux, which the
release workflow builds on those systems).

Options:
  -h, --help       Show this help
  -v, --version    Show the version`;

class UsageError extends Error {}

/** Run the command line. Returns the exit code: 0 ok, 1 problems found, 2 usage error. */
export async function run(argv: readonly string[], io: Io): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        clean: { type: 'boolean' },
        shell: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    io.err('Run "freequest --help" for usage.');
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.version) {
    io.out(VERSION);
    return 0;
  }
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    io.out(HELP);
    return values.help ? 0 : 2;
  }
  try {
    switch (command) {
      case 'check':
        return await check(rest, io);
      case 'export': {
        const [target, ...more] = rest;
        if (target === 'web') {
          return await exportWebCommand(more, values.out, values.clean === true, io);
        }
        if (target === 'mac') {
          return await exportMacCommand(more, values.out, values.clean === true, values.shell, io);
        }
        if (target === 'windows' || target === 'linux') {
          return await exportDesktopCommand(
            target,
            more,
            values.out,
            values.clean === true,
            values.shell,
            io,
          );
        }
        throw new UsageError(
          target
            ? `Unknown export target "${target}" (supported: web, mac, windows, linux)`
            : 'Missing export target (web, mac, windows or linux)',
        );
      }
      default:
        throw new UsageError(`Unknown command "${command}"`);
    }
  } catch (error) {
    if (error instanceof UsageError) {
      io.err(error.message);
      io.err('Run "freequest --help" for usage.');
      return 2;
    }
    if (error instanceof ProjectOpenError) {
      io.err(error.message);
      return 1;
    }
    throw error;
  }
}

function projectDir(args: readonly string[], io: Io): string {
  if (args.length > 1) throw new UsageError(`Expected one project folder, got: ${args.join(' ')}`);
  return resolve(io.cwd, args[0] ?? '.');
}

function printProblems(io: Io, label: string, problems: readonly Problem[]): void {
  if (problems.length === 0) return;
  io.err(`${label} (${problems.length}):`);
  for (const p of problems) io.err(`  ${p.source}: ${p.message}`);
}

async function plan(dir: string) {
  const fs = new NodeFs(dir);
  const project = await openProject(fs);
  return { fs, project, plan: await planExport(project, fs) };
}

async function check(args: readonly string[], io: Io): Promise<number> {
  const dir = projectDir(args, io);
  const { project, plan: result } = await plan(dir);
  printProblems(io, 'Problems', result.errors);
  printProblems(io, 'Warnings', result.warnings);
  const name = project.manifest.data.name;
  if (result.errors.length > 0) {
    io.err(`${name}: ${count(result.errors.length, 'problem')}. The game would not start.`);
    return 1;
  }
  io.out(`${name}: no problems (${summary(project, result.files.length)}).`);
  return 0;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function summary(project: OpenedProject, files: number): string {
  return `${count(project.maps.size, 'map')}, ${count(files, 'file')} to export`;
}

/** The built release player, read from disk. */
async function player(io: Io): Promise<PlayerFiles> {
  let dir = io.playerDir;
  if (!dir) {
    try {
      dir = dirname(createRequire(import.meta.url).resolve('@freequest/player/files.json'));
    } catch {
      throw new Error(
        'The release player is not built. Run "pnpm --filter @freequest/player build" first.',
      );
    }
  }
  const root = dir;
  const list = JSON.parse(await readFile(join(root, 'files.json'), 'utf8')) as { files: string[] };
  return {
    files: list.files,
    read: async (path) => new Uint8Array(await readFile(join(root, ...path.split('/')))),
  };
}

/** Make sure `out` can receive an export: empty or missing, or a previous export with --clean. */
async function prepareOut(out: string, project: string, clean: boolean): Promise<NodeFs> {
  const inside = (a: string, b: string) => {
    const rel = relative(b, a);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (inside(out, project) || inside(project, out)) {
    throw new UsageError('The output folder must be outside the project folder.');
  }
  const target = new NodeFs(out);
  const state = await inspectTarget(target);
  if (state.kind === 'other') {
    throw new UsageError(
      `${out} isn't empty and isn't a FreeQuest export. Choose an empty folder.`,
    );
  }
  if (state.kind === 'export') {
    if (!clean) throw new UsageError(`${out} holds a previous export. Add --clean to replace it.`);
    await clearExport(target);
  }
  return target;
}

async function exportWebCommand(
  args: readonly string[],
  out: string | undefined,
  clean: boolean,
  io: Io,
): Promise<number> {
  const dir = projectDir(args, io);
  if (!out) throw new UsageError('Missing --out <folder>');
  const outDir = resolve(io.cwd, out);
  const { fs, project, plan: result } = await plan(dir);
  printProblems(io, 'Warnings', result.warnings);
  if (result.errors.length > 0) {
    printProblems(io, 'Problems', result.errors);
    io.err('Not exported: fix the problems above first (the game would not start).');
    return 1;
  }
  const built = await player(io);
  const target = await prepareOut(outDir, dir, clean);
  const written = await exportWeb({
    project,
    plan: result,
    source: fs,
    target,
    player: built,
    freequestVersion: VERSION,
  });
  const size = (written.bytes / 1024 / 1024).toFixed(1);
  io.out(
    `Exported ${project.manifest.data.name} for the web to ${outDir} (${count(written.files, 'game file')}, ${size} MB).`,
  );
  io.out('Upload the whole folder to a web host (e.g. itch.io); index.html starts the game.');
  return 0;
}

/** Where the repo's staged shell is, relative to this file (src/ or dist/ alike). */
const DEFAULT_SHELL = fileURLToPath(
  new URL(`../../../apps/player-desktop/dist/macos/${MAC_SHELL_NAME}`, import.meta.url),
);

export type SignRunner = (command: string, args: readonly string[]) => Promise<void>;

const runCommand: SignRunner = async (command, args) => {
  await promisify(execFile)(command, [...args]);
};

async function exportMacCommand(
  args: readonly string[],
  out: string | undefined,
  clean: boolean,
  shellPath: string | undefined,
  io: Io,
): Promise<number> {
  const dir = projectDir(args, io);
  if (!out) throw new UsageError('Missing --out <folder>');
  const outDir = resolve(io.cwd, out);
  const shellDir = shellPath ? resolve(io.cwd, shellPath) : (io.macShell ?? DEFAULT_SHELL);
  if (!existsSync(join(shellDir, 'Contents', 'Info.plist'))) {
    throw new Error(
      `No desktop player app at ${shellDir}. Build it on a Mac with ` +
        '"pnpm --filter @freequest/player-desktop build:shell", or pass --shell <app>.',
    );
  }
  const { fs, project, plan: result } = await plan(dir);
  printProblems(io, 'Warnings', result.warnings);
  if (result.errors.length > 0) {
    printProblems(io, 'Problems', result.errors);
    io.err('Not exported: fix the problems above first (the game would not start).');
    return 1;
  }
  const target = await prepareOut(outDir, dir, clean);
  const written = await exportMac({
    project,
    plan: result,
    source: fs,
    shell: new NodeFs(shellDir),
    target,
    freequestVersion: VERSION,
  });
  const appPath = join(outDir, written.app);
  const size = (written.bytes / 1024 / 1024).toFixed(1);
  io.out(`Exported ${project.manifest.data.name} as ${appPath} (${size} MB).`);
  if ((io.platform ?? process.platform) === 'darwin') {
    const sign = macSignCommand(appPath);
    await (io.sign ?? runCommand)(sign.command, sign.args);
    io.out(
      'Signed ad-hoc. Zip it to share; players open it with right-click > Open the first time.',
    );
  } else {
    io.err('Not signed: run "codesign --force --deep --sign - <app>" on a Mac before sharing it.');
  }
  return 0;
}

/** Where the repo keeps the Windows and Linux players (CI builds them on those systems). */
const desktopShellDir = (target: DesktopTarget) =>
  fileURLToPath(new URL(`../../../apps/player-desktop/dist/${target}`, import.meta.url));

async function exportDesktopCommand(
  target: DesktopTarget,
  args: readonly string[],
  out: string | undefined,
  clean: boolean,
  shellPath: string | undefined,
  io: Io,
): Promise<number> {
  const dir = projectDir(args, io);
  if (!out) throw new UsageError('Missing --out <folder>');
  const outDir = resolve(io.cwd, out);
  const shellDir = shellPath
    ? resolve(io.cwd, shellPath)
    : (io.desktopShells?.[target] ?? desktopShellDir(target));
  const shell = new NodeFs(shellDir);
  const problem = existsSync(shellDir) ? await desktopShellProblem(target, shell) : 'no folder';
  if (problem) {
    throw new Error(
      `No ${DESKTOP_TARGET_NAMES[target]} player at ${shellDir} (${problem}). It's built on ` +
        `${DESKTOP_TARGET_NAMES[target]} (see the release workflow); pass --shell <folder> to use one.`,
    );
  }
  const { fs, project, plan: result } = await plan(dir);
  printProblems(io, 'Warnings', result.warnings);
  if (result.errors.length > 0) {
    printProblems(io, 'Problems', result.errors);
    io.err('Not exported: fix the problems above first (the game would not start).');
    return 1;
  }
  const output = await prepareOut(outDir, dir, clean);
  const written = await exportDesktop({
    target,
    project,
    plan: result,
    source: fs,
    shell,
    output,
    freequestVersion: VERSION,
  });
  const size = (written.bytes / 1024 / 1024).toFixed(1);
  io.out(
    `Exported ${project.manifest.data.name} for ${DESKTOP_TARGET_NAMES[target]} to ${join(outDir, written.folder)} (${size} MB).`,
  );
  io.out(
    target === 'windows'
      ? `Zip the "${written.folder}" folder to share; players unzip it and run ${written.program}.`
      : `Share the "${written.folder}" folder as a .tar.gz (keeps ${written.program} runnable); it needs WebKitGTK 4.1.`,
  );
  return 0;
}
