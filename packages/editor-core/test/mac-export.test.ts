import { describe, expect, it } from 'vitest';
import {
  EXPORT_MARKER,
  MemoryFs,
  exportMac,
  macAppName,
  macBundleId,
  macSignCommand,
  openProject,
  planExport,
  setPlistStrings,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
\t<key>CFBundleExecutable</key>
\t<string>freequest-player</string>
\t<key>CFBundleIdentifier</key>
\t<string>org.freequest.player</string>
\t<key>CFBundleName</key>
\t<string>FreeQuest Player</string>
</dict>
</plist>
`;

/** A stand-in for the built shell app. */
function shell(): MemoryFs {
  const fs = new MemoryFs({ 'Contents/Info.plist': PLIST }, 'shell');
  fs.binaries.set('Contents/MacOS/freequest-player', Uint8Array.from([0xcf, 0xfa, 0xed, 0xfe]));
  fs.binaries.set('Contents/Resources/icon.icns', Uint8Array.from([1, 2, 3]));
  fs.files.set('Contents/Resources/game/project.json', '{"placeholder":true}');
  fs.files.set('Contents/_CodeSignature/CodeResources', 'old seal');
  return fs;
}

describe('Mac export helpers', () => {
  it('names apps and bundle ids safely', () => {
    expect(macAppName('FreeQuest Demo', 'demo')).toBe('FreeQuest Demo.app');
    expect(macAppName('A/B: the  "Quest"', 'x')).toBe('A-B- the -Quest-.app');
    expect(macAppName('...', 'my-game')).toBe('my-game.app');
    expect(macBundleId('my_game')).toBe('org.freequest.game.my-game');
  });

  it('replaces and adds Info.plist strings, escaping XML', () => {
    const out = setPlistStrings(PLIST, {
      CFBundleName: 'Tom & Jerry <3',
      CFBundleDisplayName: 'Tom & Jerry <3',
    });
    expect(out).toContain('<key>CFBundleName</key>\n\t<string>Tom &amp; Jerry &lt;3</string>');
    expect(out).toContain(
      '<key>CFBundleDisplayName</key>\n\t<string>Tom &amp; Jerry &lt;3</string>\n</dict>',
    );
    expect(out).toContain('<string>freequest-player</string>');
    expect(() => setPlistStrings('<plist/>', { A: 'b' })).toThrow(/dictionary/);
  });

  it('signs with an ad-hoc identity', () => {
    expect(macSignCommand('/out/Game.app')).toEqual({
      command: '/usr/bin/codesign',
      args: ['--force', '--deep', '--sign', '-', '/out/Game.app'],
    });
  });
});

describe('exportMac', () => {
  it('copies the shell under the game name with the game inside', async () => {
    const source = await memoryCopy(DEMO);
    const project = await openProject(source);
    const plan = await planExport(project, source);
    const target = new MemoryFs({}, 'out');
    const result = await exportMac({
      project,
      plan,
      source,
      shell: shell(),
      target,
      freequestVersion: '9.9.9',
      now: new Date('2026-11-11T00:00:00Z'),
    });
    expect(result.app).toBe('FreeQuest Demo.app');
    const app = 'FreeQuest Demo.app/Contents';
    // The program stays runnable; the placeholder game and old signature are left behind.
    expect(target.executables).toEqual(new Set([`${app}/MacOS/freequest-player`]));
    expect(target.binaries.has(`${app}/Resources/icon.icns`)).toBe(true);
    expect(target.files.has(`${app}/_CodeSignature/CodeResources`)).toBe(false);
    expect(await target.readText(`${app}/Resources/game/project.json`)).toContain('freequest-demo');
    const plist = await target.readText(`${app}/Info.plist`);
    expect(plist).toContain('<string>org.freequest.game.freequest-demo</string>');
    expect(plist).toContain('<key>CFBundleName</key>\n\t<string>FreeQuest Demo</string>');
    const marker = JSON.parse(await target.readText(EXPORT_MARKER)) as Record<string, unknown>;
    expect(marker).toMatchObject({
      target: 'mac',
      app: 'FreeQuest Demo.app',
      game: 'freequest-demo',
    });
    await expect(
      exportMac({ project, plan, source, shell: shell(), target, freequestVersion: '1' }),
    ).rejects.toThrow(/must be empty/);
  });

  it('refuses an incomplete shell', async () => {
    const source = await memoryCopy(DEMO);
    const project = await openProject(source);
    await expect(
      exportMac({
        project,
        plan: await planExport(project, source),
        source,
        shell: new MemoryFs({ 'Contents/MacOS/x': '' }),
        target: new MemoryFs(),
        freequestVersion: '1',
      }),
    ).rejects.toThrow(/incomplete/);
  });
});
