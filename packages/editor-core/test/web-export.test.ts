import { describe, expect, it } from 'vitest';
import {
  EXPORT_MARKER,
  MemoryFs,
  clearExport,
  encodeUtf8,
  exportWeb,
  inspectTarget,
  openProject,
  planExport,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const player = {
  files: ['index.html', 'player/main.js'],
  read: async (path: string) => encodeUtf8(`// ${path}`),
};

async function exportDemo(target: MemoryFs) {
  const source = await memoryCopy(DEMO);
  const project = await openProject(source);
  const plan = await planExport(project, source);
  const progress: number[] = [];
  const result = await exportWeb({
    project,
    plan,
    source,
    target,
    player,
    freequestVersion: '9.9.9',
    now: new Date('2026-11-10T12:00:00Z'),
    onProgress: (p) => progress.push(p.total),
  });
  return { plan, result, progress };
}

describe('web export', () => {
  it('writes the game, the player and a marker into an empty folder', async () => {
    const target = new MemoryFs({}, 'out');
    const { plan, result, progress } = await exportDemo(target);
    expect(result.files).toBe(plan.files.length);
    expect(new Set(progress)).toEqual(new Set([plan.files.length + 2]));
    expect(await target.readText('player/main.js')).toBe('// player/main.js');
    expect(await target.readText('game/project.json')).toContain('"freequest-demo"');
    expect(JSON.parse(await target.readText(EXPORT_MARKER))).toEqual({
      formatVersion: 1,
      target: 'web',
      game: 'freequest-demo',
      name: 'FreeQuest Demo',
      exportedAt: '2026-11-10T12:00:00.000Z',
      freequest: '9.9.9',
    });
  });

  it('tells empty folders, previous exports and other folders apart', async () => {
    const target = new MemoryFs({}, 'out');
    expect(await inspectTarget(target)).toEqual({ kind: 'empty' });
    await exportDemo(target);
    expect(await inspectTarget(target)).toMatchObject({ kind: 'export', game: 'freequest-demo' });
    await expect(exportDemo(target)).rejects.toThrow(/must be empty/);

    await clearExport(target);
    expect(await inspectTarget(target)).toEqual({ kind: 'empty' });

    const other = new MemoryFs({ 'thesis.txt': 'keep me' }, 'other');
    expect(await inspectTarget(other)).toEqual({ kind: 'other', files: 1 });
    await expect(clearExport(other)).rejects.toThrow(/refusing/);
    expect(await other.readText('thesis.txt')).toBe('keep me');
  });
});
