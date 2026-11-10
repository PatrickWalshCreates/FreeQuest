import type { GameMap } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ProjectDocument, openProject, playtestSource } from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

describe('playtestSource', () => {
  it('serves unsaved edits, frozen at the time of the snapshot', async () => {
    const fs = await memoryCopy(DEMO);
    const doc = new ProjectDocument(await openProject(fs));
    const path = 'data/maps/map001.json';
    doc.update(path, 'map', 'Rename', (m) => ({ ...m, name: 'Unsaved name' }));
    const source = playtestSource(doc);
    doc.update(path, 'map', 'Rename', (m) => ({ ...m, name: 'Later edit' }));

    const map = (await source.readJson(path)) as GameMap;
    expect(map.name).toBe('Unsaved name');
    // A copy: changing it doesn't touch the document.
    map.name = 'Changed by the game';
    expect(doc.file(path)?.data).toMatchObject({ name: 'Later edit' });
    expect(await source.assetUrl('assets/a.png')).toBe('memory:assets/a.png');
  });

  it('falls back to disk for files the editor could not load', async () => {
    const fs = await memoryCopy(DEMO);
    fs.files.set('data/maps/house.json', '{ broken');
    const source = playtestSource(new ProjectDocument(await openProject(fs)));
    await expect(source.readJson('data/maps/house.json')).rejects.toThrow(
      /house\.json: invalid JSON/,
    );
  });
});
