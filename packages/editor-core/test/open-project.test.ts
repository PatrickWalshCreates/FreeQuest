import { describe, expect, it } from 'vitest';
import {
  FileNotFoundError,
  InvalidPathError,
  MemoryFs,
  ProjectOpenError,
  normalizeProjectPath,
  openProject,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

describe('normalizeProjectPath', () => {
  it('accepts project-relative paths', () => {
    expect(normalizeProjectPath('project.json')).toBe('project.json');
    expect(normalizeProjectPath('data/maps/map001.json')).toBe('data/maps/map001.json');
  });

  it.each([
    '',
    '/etc/passwd',
    'C:/Windows',
    '../outside.json',
    'data/../../outside.json',
    'data//maps.json',
    './project.json',
    'data\\maps\\a.json',
    'data/',
  ])('rejects %j', (path) => {
    expect(() => normalizeProjectPath(path)).toThrow(InvalidPathError);
  });
});

describe('MemoryFs', () => {
  it('reads what was written and reports missing files', async () => {
    const fs = new MemoryFs({ 'a.json': '{}' });
    await fs.writeText('b/c.json', '[]');
    expect(await fs.readText('a.json')).toBe('{}');
    expect(await fs.readText('b/c.json')).toBe('[]');
    await expect(fs.readText('missing.json')).rejects.toBeInstanceOf(FileNotFoundError);
    await expect(fs.readText('../a.json')).rejects.toBeInstanceOf(InvalidPathError);
  });
});

describe('openProject', () => {
  it('opens the demo project with no problems', async () => {
    const project = await openProject(await memoryCopy(DEMO));
    expect(project.problems).toEqual([]);
    expect(project.manifest.data.name).toBe('FreeQuest Demo');
    expect([...project.maps.keys()]).toEqual(['map001', 'house']);
    expect(project.maps.get('house')?.data?.id).toBe('house');
    expect([...project.tilesets.keys()]).toEqual(['overworld']);
    expect([...project.characters.keys()]).toEqual(['hero', 'villager', 'mage', 'chest']);
    expect(Object.keys(project.database).sort()).toEqual([
      'actors',
      'classes',
      'enemies',
      'equipment',
      'items',
      'skills',
      'states',
      'system',
      'troops',
    ]);
    expect([...project.maps.values()].every((m) => !m.migrated)).toBe(true);
  });

  it('refuses a folder without a readable project.json', async () => {
    await expect(openProject(new MemoryFs({}, 'empty'))).rejects.toThrow(ProjectOpenError);
    await expect(openProject(new MemoryFs({ 'project.json': '{' }))).rejects.toThrow(
      /invalid JSON/,
    );
  });

  it('keeps going past broken files and reports each one', async () => {
    const fs = await memoryCopy(DEMO);
    fs.files.delete('data/maps/house.json');
    fs.files.set('data/tilesets/overworld.json', '{ nope');
    const map = JSON.parse(await fs.readText('data/maps/map001.json')) as Record<string, unknown>;
    fs.files.set('data/maps/map001.json', JSON.stringify({ ...map, id: 'renamed' }));

    const project = await openProject(fs);
    expect(project.maps.get('house')?.data).toBeNull();
    expect(project.maps.get('map001')?.data?.id).toBe('renamed');
    expect(project.tilesets.get('overworld')?.data).toBeNull();
    expect(project.problems).toEqual([
      { source: 'data/tilesets/overworld.json', message: expect.stringMatching(/^invalid JSON/) },
      {
        source: 'data/maps/map001.json',
        message: 'id "renamed" does not match the id "map001" in project.json',
      },
      { source: 'data/maps/house.json', message: 'file not found' },
    ]);
  });

  it('runs cross-file checks once every file loads', async () => {
    const fs = await memoryCopy(DEMO);
    const manifest = JSON.parse(await fs.readText('project.json')) as {
      switches: { id: string }[];
    };
    manifest.switches = manifest.switches.filter((s) => s.id !== 'mira_joined');
    fs.files.set('project.json', JSON.stringify(manifest));
    const project = await openProject(fs);
    expect(project.problems.length).toBeGreaterThan(0);
    expect(project.problems.every((p) => p.source === 'references')).toBe(true);
    expect(project.problems[0]?.message).toContain('"mira_joined"');
  });

  it('flags files in an older format', async () => {
    const fs = await memoryCopy(DEMO);
    const map = JSON.parse(await fs.readText('data/maps/house.json')) as Record<string, unknown>;
    delete map['music'];
    fs.files.set('data/maps/house.json', JSON.stringify({ ...map, formatVersion: 4 }));
    const project = await openProject(fs);
    expect(project.problems).toEqual([]);
    expect(project.maps.get('house')?.migrated).toBe(true);
    expect(project.maps.get('map001')?.migrated).toBe(false);
  });
});
