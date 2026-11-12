import { join } from 'node:path';
import { stableStringify } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  MemoryFs,
  TEMPLATE_INFO_FILE,
  type TemplateSource,
  createProject,
  newProjectProblem,
  openProject,
  planExport,
  suggestGameId,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const STARTER = join(DEMO, '..', '..', 'templates', 'starter');

async function template(root: string): Promise<TemplateSource> {
  const fs = await memoryCopy(root);
  return { files: await fs.list(''), read: (path) => fs.readBytes(path) };
}

describe('new projects', () => {
  it('makes a starter project that opens and exports with no problems', async () => {
    const target = new MemoryFs({}, 'new');
    const progress: number[] = [];
    await createProject(await template(STARTER), target, {
      name: '  Moonlit Quest ',
      id: 'moonlit-quest',
      onProgress: (done) => progress.push(done),
    });
    expect(target.files.has(TEMPLATE_INFO_FILE)).toBe(false);
    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    expect(project.manifest.data).toMatchObject({ name: 'Moonlit Quest', id: 'moonlit-quest' });
    expect([...project.maps.keys()]).toEqual(['map001']);
    // Written in canonical form, like everything the editor saves.
    expect(await target.readText('project.json')).toMatch(
      /^\{\n {2}"formatVersion": \d+,\n {2}"id"/,
    );
    expect((await planExport(project, target)).errors).toEqual([]);
    expect(progress.at(-1)).toBe(progress.length);
  });

  it('can start from the demo too', async () => {
    const target = new MemoryFs({}, 'new');
    await createProject(await template(DEMO), target, { name: 'My Demo', id: 'my-demo' });
    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    expect(project.maps.size).toBe(2);
  });

  it('refuses a folder that is not empty, and bad names or ids', async () => {
    const starter = await template(STARTER);
    const used = new MemoryFs({ 'notes.txt': 'mine' });
    await expect(createProject(starter, used, { name: 'A', id: 'a' })).rejects.toThrow(/empty/);
    expect(await used.readText('notes.txt')).toBe('mine');
    expect(newProjectProblem({ name: ' ', id: 'a' })).toMatch(/name/);
    expect(newProjectProblem({ name: 'A', id: 'Bad Id' })).toMatch(/lowercase/);
    await expect(createProject(starter, new MemoryFs(), { name: 'A', id: '' })).rejects.toThrow();
  });

  it('keeps the starter template in canonical form (regenerate with pnpm gen:templates)', async () => {
    const fs = await memoryCopy(STARTER);
    for (const path of await fs.list('')) {
      if (!path.endsWith('.json') || path === TEMPLATE_INFO_FILE) continue;
      const text = await fs.readText(path);
      expect(text, path).toBe(stableStringify(JSON.parse(text)));
    }
  });

  it('suggests ids from names', () => {
    expect(suggestGameId('My Big Quest!')).toBe('my-big-quest');
    expect(suggestGameId('★')).toBe('my-game');
  });
});
