import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ProjectSource, loadProject } from '../src/loader.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');

/** The demo from disk, with optional replacement files (like the editor's unsaved edits). */
function source(overrides: Record<string, unknown> = {}): ProjectSource & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async readJson(path) {
      reads.push(path);
      if (path in overrides) return structuredClone(overrides[path]);
      return JSON.parse(await readFile(join(DEMO, path), 'utf8')) as unknown;
    },
    assetUrl: (path) => Promise.resolve(`asset:${path}`),
  };
}

describe('loadProject from a ProjectSource', () => {
  it('loads the demo, reading the start map but not the others', async () => {
    const src = source();
    const project = await loadProject(src);
    expect(project.manifest.name).toBe('FreeQuest Demo');
    expect([...project.maps.keys()]).toEqual(['map001']);
    expect(src.reads).not.toContain('data/maps/house.json');
    expect((await project.loadMap('house')).name).toBe("Elder's house");
    expect(await project.assetUrl('assets/x.png')).toBe('asset:assets/x.png');
  });

  it('uses replacement files, so unsaved edits are what gets played', async () => {
    const map = JSON.parse(await readFile(join(DEMO, 'data/maps/map001.json'), 'utf8')) as {
      name: string;
    };
    const project = await loadProject(
      source({ 'data/maps/map001.json': { ...map, name: 'Edited meadow' } }),
    );
    expect(project.maps.get('map001')?.name).toBe('Edited meadow');
  });

  it('reports invalid files with their path', async () => {
    await expect(
      loadProject(source({ 'data/maps/map001.json': { formatVersion: 5, id: 'map001' } })),
    ).rejects.toThrow(/data\/maps\/map001\.json/);
  });
});
