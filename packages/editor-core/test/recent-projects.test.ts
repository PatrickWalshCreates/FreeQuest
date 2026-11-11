import { describe, expect, it } from 'vitest';
import {
  MAX_RECENT_PROJECTS,
  RECENT_PROJECTS_KEY,
  type RecentProject,
  type RecentStorage,
  addRecent,
  readRecent,
  removeRecent,
  writeRecent,
} from '../src/index.js';

function memory(initial?: string): RecentStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  if (initial !== undefined) data.set(RECENT_PROJECTS_KEY, initial);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
  };
}

const entry = (location: string, name = location): RecentProject => ({
  location,
  name,
  openedAt: '2026-11-10T12:00:00.000Z',
});

describe('recent projects', () => {
  it('puts the newest first and keeps one entry per location', () => {
    let list = addRecent([], entry('/a'));
    list = addRecent(list, entry('/b'));
    list = addRecent(list, entry('/a', 'Renamed'));
    expect(list.map((p) => [p.location, p.name])).toEqual([
      ['/a', 'Renamed'],
      ['/b', '/b'],
    ]);
  });

  it('keeps at most the limit', () => {
    let list: readonly RecentProject[] = [];
    for (let i = 0; i < MAX_RECENT_PROJECTS + 3; i++) list = addRecent(list, entry(`/p${i}`));
    expect(list).toHaveLength(MAX_RECENT_PROJECTS);
    expect(list[0]?.location).toBe(`/p${MAX_RECENT_PROJECTS + 2}`);
  });

  it('removes an entry', () => {
    const list = addRecent(addRecent([], entry('/a')), entry('/b'));
    expect(removeRecent(list, '/a').map((p) => p.location)).toEqual(['/b']);
  });

  it('round-trips through storage', () => {
    const storage = memory();
    expect(readRecent(storage)).toEqual([]);
    const list = addRecent(addRecent([], entry('/a')), entry('samples/demo-project', 'Demo'));
    writeRecent(storage, list);
    expect(readRecent(storage)).toEqual(list);
  });

  it('skips damaged storage and entries', () => {
    expect(readRecent(memory('not json'))).toEqual([]);
    expect(readRecent(memory('{"location":"/a"}'))).toEqual([]);
    const mixed = JSON.stringify([entry('/a'), { location: 5 }, null, entry('/a'), entry('/b')]);
    expect(readRecent(memory(mixed)).map((p) => p.location)).toEqual(['/a', '/b']);
  });
});
