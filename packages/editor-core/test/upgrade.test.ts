// Opening a project from an older FreeQuest upgrades it in memory; saving
// writes the new format only after keeping the old files byte for byte.
// Files from a newer FreeQuest are never overwritten.
import { join } from 'node:path';
import { FREEQUEST_VERSION } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  ProjectDocument,
  ProjectOpenError,
  SaveBlockedError,
  backupFolder,
  openProject,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const OLD = join(DEMO, '..', '..', 'packages', 'schema', 'test', 'fixtures', 'release-0.2');

describe('upgrading a project from an older FreeQuest', () => {
  it('lists the older files, backs them up exactly, then saves them in the new format', async () => {
    const fs = await memoryCopy(OLD);
    const before = new Map([...fs.files].map(([path, text]) => [path, text]));
    const doc = new ProjectDocument(await openProject(fs));
    // 0.2's maps (7) and manifest (6) are older now; its database files are current.
    expect(doc.olderFiles).toEqual(
      expect.arrayContaining(['project.json', 'data/maps/map001.json', 'data/maps/house.json']),
    );
    // Files whose format hasn't changed since aren't listed.
    expect(doc.olderFiles).not.toContain('data/characters/hero.json');
    expect(doc.dirty).toBe(true);
    const older = doc.olderFiles;

    const result = await doc.save();
    expect(result.backup).toMatch(
      new RegExp(`^backups/\\d{4}-\\d\\d-\\d\\d-\\d{6}-before-${FREEQUEST_VERSION}$`),
    );
    for (const path of older) {
      const copy = await fs.readText(`${result.backup}/${path}`);
      expect(copy).toBe(before.get(path));
      expect(await fs.readText(path)).not.toBe(before.get(path));
    }
    expect(doc.olderFiles).toEqual([]);
    expect(doc.lastBackup).toBe(result.backup);

    // Opened again: nothing older is left, and the project is clean.
    const again = new ProjectDocument(await openProject(fs));
    expect(again.olderFiles).toEqual([]);
    expect(again.dirty).toBe(false);
    expect(again.project.problems).toEqual([]);
  });

  it('makes no backup when nothing older is saved', async () => {
    const doc = new ProjectDocument(await openProject(await memoryCopy(DEMO)));
    expect(doc.olderFiles).toEqual([]);
    doc.update('project.json', 'manifest', 'Rename', (m) => ({ ...m, name: 'Renamed' }));
    expect((await doc.save()).backup).toBeNull();
  });

  it('names backup folders by time and the version that upgraded', () => {
    expect(backupFolder(new Date(2026, 10, 14, 9, 5, 7), '0.3.0')).toBe(
      'backups/2026-11-14-090507-before-0.3.0',
    );
  });
});

describe('a project from a newer FreeQuest', () => {
  it('won’t open when project.json is newer, and says to update', async () => {
    const fs = await memoryCopy(DEMO);
    const manifest = JSON.parse(await fs.readText('project.json')) as { formatVersion: number };
    await fs.writeText('project.json', JSON.stringify({ ...manifest, formatVersion: 99 }));
    await expect(openProject(fs)).rejects.toThrow(ProjectOpenError);
    await expect(openProject(fs)).rejects.toThrow(/newer version of FreeQuest.*Update the editor/);
  });

  it('opens with a newer file shown, and refuses to save over anything', async () => {
    const fs = await memoryCopy(DEMO);
    const map = JSON.parse(await fs.readText('data/maps/house.json')) as object;
    const newer = JSON.stringify({ ...map, formatVersion: 99 });
    await fs.writeText('data/maps/house.json', newer);
    const doc = new ProjectDocument(await openProject(fs));
    expect(doc.newerFiles).toEqual(['data/maps/house.json']);
    expect(doc.project.problems.map((p) => p.message).join()).toMatch(/newer version of FreeQuest/);
    doc.update('project.json', 'manifest', 'Rename', (m) => ({ ...m, name: 'Renamed' }));
    await expect(doc.save()).rejects.toThrow(SaveBlockedError);
    expect(await fs.readText('data/maps/house.json')).toBe(newer);
    expect(await fs.readText('project.json')).not.toContain('Renamed');
  });
});
