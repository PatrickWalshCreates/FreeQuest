import { describe, expect, it } from 'vitest';
import type { GameMap, Manifest } from '@freequest/schema';
import {
  ProjectDocument,
  openProject,
  recordRename,
  referencesTo,
  renameId,
  renameProblem,
  usagesOf,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

async function demo() {
  const fs = await memoryCopy(DEMO);
  return { fs, doc: new ProjectDocument(await openProject(fs)) };
}
const json = (fs: { files: Map<string, string> }, path: string) =>
  JSON.parse(fs.files.get(path) ?? 'null') as unknown;

describe('renaming ids', () => {
  it('renames a map, its file id, every transfer and the start, as one undo step', async () => {
    const { doc } = await demo();
    const before = usagesOf(doc.project, 'map', 'house');
    expect(renameId(doc, 'map', 'house', 'elders-house')).toBeGreaterThan(0);
    const project = doc.project;
    expect(project.maps.has('elders-house')).toBe(true);
    expect(project.maps.get('elders-house')?.data?.id).toBe('elders-house');
    expect(usagesOf(project, 'map', 'elders-house')).toEqual(before);
    expect(referencesTo(project, 'map', 'house')).toEqual([]);
    expect(project.problems).toEqual([]);
    expect(project.manifest.data.renames).toEqual({ map: { house: 'elders-house' } });
    doc.undo();
    expect(doc.project.maps.has('house')).toBe(true);
    expect(doc.project.problems).toEqual([]);
    expect(doc.project.manifest.data.renames).toBeUndefined();
    doc.redo();
    expect(doc.project.problems).toEqual([]);
  });

  it('renames a switch in conditions, commands and common event gates', async () => {
    const { doc } = await demo();
    const uses = usagesOf(doc.project, 'switch', 'accepted_request');
    renameId(doc, 'switch', 'accepted_request', 'quest-accepted');
    expect(usagesOf(doc.project, 'switch', 'quest-accepted')).toEqual(uses);
    expect(doc.project.manifest.data.switches.some((s) => s.id === 'quest-accepted')).toBe(true);
    expect(doc.project.problems).toEqual([]);
  });

  it('renames an item inside text codes too', async () => {
    const { doc } = await demo();
    renameId(doc, 'item', 'potion', 'red-potion');
    expect(doc.project.problems).toEqual([]);
    const house = doc.project.maps.get('house')?.data as GameMap;
    const chest = house.events.find((e) => e.id === 'chest');
    const message = chest?.pages[0]?.commands[0];
    expect(message).toMatchObject({ text: expect.stringContaining('{item:red-potion}') });
    expect(referencesTo(doc.project, 'item', 'potion')).toEqual([]);
  });

  it('renames an event on its own map only, and equipment slots used as keys', async () => {
    const { doc } = await demo();
    renameId(doc, 'event', 'house/chest', 'old-chest');
    const house = doc.project.maps.get('house')?.data as GameMap;
    expect(house.events.some((e) => e.id === 'old-chest')).toBe(true);
    expect(doc.project.manifest.data.renames?.event).toEqual({ 'house/chest': 'house/old-chest' });
    const slot = doc.project.database.system?.data?.equipmentSlots[0]?.id ?? '';
    renameId(doc, 'equipmentSlot', slot, 'main-hand');
    expect(doc.project.problems).toEqual([]);
    expect(doc.project.database.system?.data?.equipmentSlots[0]?.id).toBe('main-hand');
  });

  it('refuses clashes and bad ids, and saves canonical files', async () => {
    const { doc, fs } = await demo();
    expect(renameProblem(doc.project, 'map', 'house', 'map001')).toMatch(/already used/);
    expect(renameProblem(doc.project, 'switch', 'rewarded', 'Bad Id')).toMatch(/lowercase/);
    expect(renameProblem(doc.project, 'switch', 'rewarded', 'rewarded')).toMatch(/already/);
    // Switches and variables share one id space (events read more clearly that way).
    expect(renameProblem(doc.project, 'switch', 'rewarded', 'bridge_visits')).toMatch(
      /already used/,
    );
    expect(() => renameId(doc, 'map', 'house', 'map001')).toThrow(/already used/);
    renameId(doc, 'troop', 'bridge-wolf', 'wolf-ambush');
    await doc.save();
    expect(json(fs, 'data/database/troops.json')).toMatchObject({
      entries: expect.arrayContaining([expect.objectContaining({ id: 'wolf-ambush' })]),
    });
  });
});

describe('the rename record', () => {
  const m = { formatVersion: 7 } as unknown as Manifest;
  it('collapses chains and forgets renames back', () => {
    const once = recordRename(m, 'map', 'a', 'b');
    const twice = recordRename(once, 'map', 'b', 'c');
    expect(twice.renames).toEqual({ map: { a: 'c', b: 'c' } });
    const back = recordRename(recordRename(m, 'map', 'a', 'b'), 'map', 'b', 'a');
    expect(back.renames).toEqual({ map: { b: 'a' } });
    expect(recordRename(m, 'switch', 'x', 'x').renames).toBeUndefined();
  });
});
