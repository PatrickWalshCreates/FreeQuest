import { describe, expect, it } from 'vitest';
import {
  EXPORT_MARKER,
  MemoryFs,
  desktopFolderName,
  desktopProgramName,
  desktopShellProblem,
  exportDesktop,
  openProject,
  planExport,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

/** A stand-in for a player shell folder as CI builds it. */
function shell(program: string): MemoryFs {
  const fs = new MemoryFs({ 'THIRD_PARTY_NOTICES.txt': 'notices' }, 'shell');
  fs.binaries.set(program, Uint8Array.from([0x4d, 0x5a, 1, 2]));
  return fs;
}

async function demo() {
  const fs = await memoryCopy(DEMO);
  const project = await openProject(fs);
  return { fs, project, plan: await planExport(project, fs) };
}

describe('desktop export names', () => {
  it('names the folder and the program for each system', () => {
    expect(desktopFolderName('FreeQuest Demo', 'demo')).toBe('FreeQuest Demo');
    expect(desktopFolderName('A/B: "Quest"', 'x')).toBe('A-B- -Quest-');
    expect(desktopProgramName('windows', 'FreeQuest Demo', 'freequest-demo')).toBe(
      'FreeQuest Demo.exe',
    );
    expect(desktopProgramName('linux', 'FreeQuest Demo', 'freequest-demo')).toBe('freequest-demo');
  });

  it('notices a shell folder without its program', async () => {
    expect(await desktopShellProblem('windows', shell('freequest-player.exe'))).toBeNull();
    expect(await desktopShellProblem('windows', shell('freequest-player'))).toMatch(
      /Windows player \(freequest-player\.exe\) isn't there/,
    );
  });
});

describe('exportDesktop', () => {
  it('writes the program, the game and the notices into a game folder', async () => {
    const { fs, project, plan } = await demo();
    const output = new MemoryFs({}, 'out');
    const result = await exportDesktop({
      target: 'windows',
      project,
      plan,
      source: fs,
      shell: shell('freequest-player.exe'),
      output,
      freequestVersion: '9.9.9',
      now: new Date(0),
    });
    expect(result).toMatchObject({ folder: 'FreeQuest Demo', program: 'FreeQuest Demo.exe' });
    expect(output.binaries.get('FreeQuest Demo/FreeQuest Demo.exe')).toEqual(
      Uint8Array.from([0x4d, 0x5a, 1, 2]),
    );
    expect(output.binaries.has('FreeQuest Demo/THIRD_PARTY_NOTICES.txt')).toBe(true);
    expect(output.files.has('FreeQuest Demo/game/project.json')).toBe(true);
    expect(output.binaries.has('FreeQuest Demo/game/assets/tilesets/overworld.png')).toBe(true);
    expect(JSON.parse(output.files.get(EXPORT_MARKER) ?? '{}')).toMatchObject({
      target: 'windows',
      game: 'freequest-demo',
      program: 'FreeQuest Demo.exe',
      freequest: '9.9.9',
    });
    expect(output.executables.size).toBe(0);
  });

  it('marks the Linux program executable', async () => {
    const { fs, project, plan } = await demo();
    const output = new MemoryFs({}, 'out');
    await exportDesktop({
      target: 'linux',
      project,
      plan,
      source: fs,
      shell: shell('freequest-player'),
      output,
      freequestVersion: '1',
    });
    expect([...output.executables]).toEqual(['FreeQuest Demo/freequest-demo']);
  });

  it('refuses a folder that is not empty, or a shell without its program', async () => {
    const { fs, project, plan } = await demo();
    const base = { target: 'linux' as const, project, plan, source: fs, freequestVersion: '1' };
    await expect(
      exportDesktop({
        ...base,
        shell: shell('freequest-player'),
        output: new MemoryFs({ x: 'y' }),
      }),
    ).rejects.toThrow(/must be empty/);
    await expect(
      exportDesktop({ ...base, shell: shell('nothing'), output: new MemoryFs() }),
    ).rejects.toThrow(/Linux player/);
  });
});
