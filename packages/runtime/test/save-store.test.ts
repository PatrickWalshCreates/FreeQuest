import { World } from '@freequest/core';
import { type SaveFile, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { type KeyValueStorage, MemoryStorage, SaveStore } from '../src/save-store.js';
import { demoDb, readDemo } from './demo.js';

const db = demoDb();
const ANOTHER = { id: 'another-game', name: 'Another Game' };
const manifest = parseProjectFile('manifest', readDemo('project.json'));

function save(savedAt: string, gold = 0): SaveFile {
  const world = new World({
    manifest,
    map: parseProjectFile('map', readDemo('data/maps/map001.json')),
    tileset: parseProjectFile('tileset', readDemo('data/tilesets/overworld.json')),
    database: db,
  });
  world.party.gainGold(gold);
  return world.toSave({ game: manifest.id, playSeconds: 60, savedAt: new Date(savedAt) });
}

describe('SaveStore', () => {
  it('writes and reads slots, reporting empty ones', () => {
    const store = new SaveStore(new MemoryStorage(), manifest);
    const data = save('2026-01-01T00:00:00Z', 5);
    store.write(2, data);
    expect(store.list().map((s) => s.kind)).toEqual(['empty', 'save', 'empty']);
    const slot = store.read(2);
    expect(slot.kind === 'save' && slot.save).toEqual(data);
    store.remove(2);
    expect(store.read(2).kind).toBe('empty');
  });

  it('finds the most recent save for Continue', () => {
    const store = new SaveStore(new MemoryStorage(), manifest);
    expect(store.latest()).toBeNull();
    store.write(1, save('2026-01-01T00:00:00Z'));
    store.write(3, save('2026-03-01T00:00:00Z'));
    store.write(2, save('2026-02-01T00:00:00Z'));
    expect(store.latest()?.slot).toBe(3);
  });

  it('reports damaged data and other games as broken slots instead of throwing', () => {
    const storage = new MemoryStorage();
    const store = new SaveStore(storage, manifest);
    storage.setItem('freequest:game:freequest-demo:save:1', '{not json');
    storage.setItem(
      'freequest:game:freequest-demo:save:2',
      JSON.stringify({ formatVersion: 1, game: 'x' }),
    );
    store.write(3, save('2026-01-01T00:00:00Z'));
    const other = new SaveStore(storage, ANOTHER);
    other.write(1, { ...save('2026-01-01T00:00:00Z'), game: manifest.id });
    const [bad, invalid] = store.list();
    expect(bad?.kind).toBe('broken');
    expect(invalid).toMatchObject({ kind: 'broken', reason: expect.stringMatching(/save slot 2/) });
    expect(other.read(1)).toMatchObject({
      kind: 'broken',
      reason: expect.stringMatching(/another game/),
    });
  });

  it('keeps different games apart', () => {
    const storage = new MemoryStorage();
    new SaveStore(storage, manifest).write(1, save('2026-01-01T00:00:00Z'));
    expect(new SaveStore(storage, ANOTHER).read(1).kind).toBe('empty');
  });

  it('keys slots by game id, so renaming the game keeps its saves', () => {
    const storage = new MemoryStorage();
    new SaveStore(storage, manifest).write(1, save('2026-01-01T00:00:00Z'));
    expect(storage.getItem('freequest:game:freequest-demo:save:1')).not.toBeNull();
    const renamed = new SaveStore(storage, { id: manifest.id, name: 'FreeQuest Demo II' });
    expect(renamed.read(1).kind).toBe('save');
  });

  it('still loads saves made before game ids, and moves them on the next save', () => {
    const storage = new MemoryStorage();
    const legacyKey = 'freequest:FreeQuest%20Demo:save:2';
    storage.setItem(
      legacyKey,
      JSON.stringify({ ...save('2026-01-01T00:00:00Z'), game: manifest.name }),
    );
    const store = new SaveStore(storage, manifest);
    const slot = store.read(2);
    expect(slot.kind).toBe('save');
    if (slot.kind !== 'save') return;
    store.write(2, { ...slot.save, game: manifest.id });
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(store.read(2).kind).toBe('save');
  });

  it('reports storage that cannot be read as broken', () => {
    const blocked: KeyValueStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => undefined,
      removeItem: () => undefined,
    };
    expect(new SaveStore(blocked, manifest).read(1)).toMatchObject({ kind: 'broken' });
  });

  it('rejects slot numbers outside the range', () => {
    const store = new SaveStore(new MemoryStorage(), manifest);
    expect(() => store.write(0, save('2026-01-01T00:00:00Z'))).toThrow(/no save slot 0/);
    expect(() => store.read(4)).toThrow(/no save slot 4/);
  });
});
