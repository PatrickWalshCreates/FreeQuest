import { FREEQUEST_VERSION } from '@freequest/schema';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openProject } from '@freequest/editor-core';
import { afterEach, describe, expect, it } from 'vitest';
import { EXPORT_MARKER, NodeFs, run } from '../src/index.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');
const temps: string[] = [];

function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'freequest-cli-'));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A stand-in for the built player: an index.html and one script. */
function fakePlayer(): string {
  const dir = temp();
  mkdirSync(join(dir, 'player'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>player</title>');
  writeFileSync(join(dir, 'player', 'main.js'), 'console.log("player")');
  writeFileSync(
    join(dir, 'files.json'),
    JSON.stringify({ files: ['index.html', 'player/main.js'] }),
  );
  return dir;
}

/** A stand-in for the desktop player app. */
function fakeShell(): string {
  const app = join(temp(), 'FreeQuest Player.app');
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    '<plist><dict>\n\t<key>CFBundleName</key>\n\t<string>FreeQuest Player</string>\n</dict></plist>\n',
  );
  writeFileSync(join(app, 'Contents', 'MacOS', 'freequest-player'), 'binary');
  return app;
}

/** Stand-ins for the Windows and Linux players: the program and its notices. */
function fakeDesktopShell(program: string): string {
  const dir = temp();
  writeFileSync(join(dir, program), 'binary');
  writeFileSync(join(dir, 'THIRD_PARTY_NOTICES.txt'), 'notices');
  return dir;
}

const signed: string[][] = [];

async function cli(args: string[], cwd = DEMO, platform = 'darwin') {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(args, {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    cwd,
    playerDir: fakePlayer(),
    macShell: fakeShell(),
    desktopShells: {
      windows: fakeDesktopShell('freequest-player.exe'),
      linux: fakeDesktopShell('freequest-player'),
    },
    platform,
    sign: async (command, a) => void signed.push([command, ...a]),
  });
  return { code, out: out.join('\n'), err: err.join('\n') };
}

/** A copy of the demo that a test may break. */
function demoCopy(): string {
  const dir = join(temp(), 'project');
  cpSync(DEMO, dir, { recursive: true });
  return dir;
}

describe('freequest check', () => {
  it('reports a clean project', async () => {
    const result = await cli(['check']);
    expect(result.code).toBe(0);
    expect(result.out).toBe('FreeQuest Demo: no problems (2 maps, 59 files to export).');
  });

  it('lists problems and fails', async () => {
    const dir = demoCopy();
    rmSync(join(dir, 'assets/enemies/bat.png'));
    const result = await cli(['check', dir]);
    expect(result.code).toBe(1);
    expect(result.err).toContain('assets/enemies/bat.png: image not found (used by enemy Bat)');
    expect(result.err).toContain('1 problem. The game would not start.');
  });

  it('explains a folder that is not a project', async () => {
    const result = await cli(['check', temp()]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/is not a FreeQuest project/);
  });
});

describe('freequest export web', () => {
  it('writes a playable folder: player, game files and a marker', async () => {
    const out = join(temp(), 'web');
    const result = await cli(['export', 'web', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(
      /^Exported FreeQuest Demo for the web to .*\(59 game files, \d+\.\d MB\)\./,
    );
    expect(existsSync(join(out, 'index.html'))).toBe(true);
    expect(existsSync(join(out, 'player/main.js'))).toBe(true);
    const marker = JSON.parse(readFileSync(join(out, EXPORT_MARKER), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(marker).toMatchObject({ target: 'web', game: 'freequest-demo', name: 'FreeQuest Demo' });
    const game = await openProject(new NodeFs(join(out, 'game')));
    expect(game.problems).toEqual([]);
  });

  it('replaces a previous export only with --clean, and never a folder of other files', async () => {
    const out = join(temp(), 'web');
    expect((await cli(['export', 'web', '-o', out])).code).toBe(0);
    writeFileSync(join(out, 'stale.txt'), 'old');
    const again = await cli(['export', 'web', '-o', out]);
    expect(again.code).toBe(2);
    expect(again.err).toMatch(/--clean/);
    expect((await cli(['export', 'web', '-o', out, '--clean'])).code).toBe(0);
    expect(existsSync(join(out, 'stale.txt'))).toBe(false);

    const other = temp();
    writeFileSync(join(other, 'important.doc'), 'keep me');
    const refused = await cli(['export', 'web', '-o', other, '--clean']);
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/isn't a FreeQuest export/);
    expect(existsSync(join(other, 'important.doc'))).toBe(true);
  });

  it('refuses to export into the project, or with problems', async () => {
    const inside = await cli(['export', 'web', '-o', join(DEMO, 'export')]);
    expect(inside.code).toBe(2);
    expect(inside.err).toMatch(/outside the project/);

    const dir = demoCopy();
    rmSync(join(dir, 'assets/tilesets/overworld.png'));
    const out = join(temp(), 'web');
    const broken = await cli(['export', 'web', dir, '-o', out]);
    expect(broken.code).toBe(1);
    expect(broken.err).toMatch(/Not exported/);
    expect(existsSync(out)).toBe(false);
  });
});

describe('freequest export windows and linux', () => {
  it('writes a game folder with the renamed program', async () => {
    const out = join(temp(), 'win');
    const result = await cli(['export', 'windows', '--out', out]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/Exported FreeQuest Demo for Windows/);
    expect(existsSync(join(out, 'FreeQuest Demo', 'FreeQuest Demo.exe'))).toBe(true);
    expect(existsSync(join(out, 'FreeQuest Demo', 'game', 'project.json'))).toBe(true);
    expect(existsSync(join(out, 'FreeQuest Demo', 'THIRD_PARTY_NOTICES.txt'))).toBe(true);
  });

  it('keeps the Linux program executable', async () => {
    const out = join(temp(), 'linux');
    expect((await cli(['export', 'linux', '--out', out])).code).toBe(0);
    const program = join(out, 'FreeQuest Demo', 'freequest-demo');
    expect(statSync(program).mode & 0o111).not.toBe(0);
  });

  it('explains a missing player', async () => {
    await expect(
      cli(['export', 'linux', '--out', join(temp(), 'x'), '--shell', temp()]),
    ).rejects.toThrow(/No Linux player .*release workflow/);
  });
});

describe('freequest export mac', () => {
  it('builds a signed app named after the game, with the game inside', async () => {
    signed.length = 0;
    const out = join(temp(), 'mac');
    const result = await cli(['export', 'mac', '-o', out]);
    expect(result.code).toBe(0);
    const app = join(out, 'FreeQuest Demo.app');
    expect(result.out).toContain(`as ${app}`);
    expect(result.out).toMatch(/Signed ad-hoc/);
    expect(signed).toEqual([['/usr/bin/codesign', '--force', '--deep', '--sign', '-', app]]);
    expect(statSync(join(app, 'Contents/MacOS/freequest-player')).mode & 0o111).toBeTruthy();
    expect(readFileSync(join(app, 'Contents/Info.plist'), 'utf8')).toContain(
      '<string>FreeQuest Demo</string>',
    );
    const game = await openProject(new NodeFs(join(app, 'Contents/Resources/game')));
    expect(game.problems).toEqual([]);
  });

  it('skips signing off macOS and explains a missing shell', async () => {
    signed.length = 0;
    const linux = await cli(['export', 'mac', '-o', join(temp(), 'mac')], DEMO, 'linux');
    expect(linux.code).toBe(0);
    expect(linux.err).toMatch(/Not signed/);
    expect(signed).toEqual([]);
    await expect(
      cli(['export', 'mac', '-o', join(temp(), 'm'), '--shell', temp()]),
    ).rejects.toThrow(/No desktop player app/);
  });
});

describe('usage', () => {
  it('shows help, the version, and usage errors', async () => {
    expect((await cli(['--help'])).out).toMatch(/freequest check \[project\]/);
    expect((await cli([])).code).toBe(2);
    expect((await cli(['-v'])).out).toBe(FREEQUEST_VERSION);
    const unknown = await cli(['frobnicate']);
    expect(unknown).toMatchObject({ code: 2, err: expect.stringMatching(/Unknown command/) });
    expect((await cli(['export', 'zip', '-o', 'x'])).err).toMatch(/supported: web/);
    expect((await cli(['export', 'web'])).err).toMatch(/Missing --out/);
    expect((await cli(['check', '--bogus'])).code).toBe(2);
  });
});

describe('freequest import mz', () => {
  const TINY = join(import.meta.dirname, '..', '..', 'importer', 'test', 'fixtures', 'tiny-mz');

  it('makes a new project from an MZ project, which then checks clean', async () => {
    const out = join(temp(), 'Lantern Hollow');
    const result = await cli(['import', 'mz', TINY, '--out', out]);
    expect(result).toMatchObject({ code: 0, err: '' });
    expect(result.out).toMatch(/Imported Lantern Hollow into .*game id "lantern-hollow"/);
    expect(result.out).toContain('IMPORT-REPORT.md');
    expect(existsSync(join(out, 'IMPORT-REPORT.md'))).toBe(true);
    expect((await openProject(new NodeFs(out))).problems).toEqual([]);
    expect((await cli(['check', out])).code).toBe(0);
  });

  it('takes a name, and refuses busy folders, folders inside the MZ project and non-projects', async () => {
    const named = join(temp(), 'named');
    expect(
      (await cli(['import', 'mz', TINY, '--out', named, '--name', 'Second Hollow'])).out,
    ).toMatch(/game id "second-hollow"/);
    const busy = temp();
    writeFileSync(join(busy, 'keep.txt'), 'mine');
    expect(await cli(['import', 'mz', TINY, '--out', busy])).toMatchObject({
      code: 2,
      err: expect.stringMatching(/isn't empty/),
    });
    expect(readFileSync(join(busy, 'keep.txt'), 'utf8')).toBe('mine');
    expect(await cli(['import', 'mz', TINY, '--out', join(TINY, 'out')])).toMatchObject({
      code: 2,
      err: expect.stringMatching(/outside the MZ project/),
    });
    expect(existsSync(join(TINY, 'out'))).toBe(false);
    expect(await cli(['import', 'mz', DEMO, '--out', join(temp(), 'x')])).toMatchObject({
      code: 1,
      err: expect.stringMatching(/isn't an RPG Maker MZ project/),
    });
    expect(await cli(['import', 'mv', TINY, '--out', join(temp(), 'y')])).toMatchObject({
      code: 2,
      err: expect.stringMatching(/Unknown import kind "mv"/),
    });
  });
});

describe('plugins (M15)', () => {
  /** The demo with an enabled plugin (script + a picture) and a turned-off one. */
  function withPlugins(): string {
    const dir = demoCopy();
    const declaration = (id: string) => ({
      formatVersion: 1,
      id,
      name: id,
      version: '1.0.0',
      apiVersion: 1,
      entry: 'main.js',
      settings: [],
      commands: [],
    });
    for (const id of ['rainfall', 'clock']) {
      mkdirSync(join(dir, 'plugins', id), { recursive: true });
      writeFileSync(join(dir, 'plugins', id, 'plugin.json'), JSON.stringify(declaration(id)));
      writeFileSync(join(dir, 'plugins', id, 'main.js'), 'export default { setup() {} };');
    }
    writeFileSync(join(dir, 'plugins', 'rainfall', 'drop.png'), 'png');
    const manifest = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as {
      plugins?: unknown[];
    };
    // Beside the demo's own plugins.
    manifest.plugins = [
      ...(manifest.plugins ?? []),
      { id: 'rainfall', path: 'plugins/rainfall/plugin.json', enabled: true },
      { id: 'clock', path: 'plugins/clock/plugin.json', enabled: false },
    ];
    writeFileSync(join(dir, 'project.json'), JSON.stringify(manifest));
    return dir;
  }

  it('are checked: a missing script is a problem', async () => {
    const dir = withPlugins();
    expect((await cli(['check', dir])).code).toBe(0);
    rmSync(join(dir, 'plugins', 'rainfall', 'main.js'));
    const result = await cli(['check', dir]);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/plugins\/rainfall\/plugin\.json: .*main\.js/);
  });

  it('ship with every export: an enabled one’s whole folder, a turned-off one’s plugin.json', async () => {
    const dir = withPlugins();
    const games: Record<string, string> = {
      web: 'game',
      mac: 'FreeQuest Demo.app/Contents/Resources/game',
      windows: 'FreeQuest Demo/game',
      linux: 'FreeQuest Demo/game',
    };
    for (const [target, game] of Object.entries(games)) {
      const out = join(temp(), target);
      const result = await cli(['export', target, dir, '--out', out]);
      expect(result.code, `${target}: ${result.err}`).toBe(0);
      const root = join(out, game);
      expect(existsSync(join(root, 'plugins/rainfall/main.js')), target).toBe(true);
      expect(existsSync(join(root, 'plugins/rainfall/drop.png')), target).toBe(true);
      expect(existsSync(join(root, 'plugins/clock/plugin.json')), target).toBe(true);
      expect(existsSync(join(root, 'plugins/clock/main.js')), target).toBe(false);
      expect((await openProject(new NodeFs(root))).problems, target).toEqual([]);
    }
  });
});
