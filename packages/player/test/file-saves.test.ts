import { MemoryStorage, SaveStore } from '@freequest/runtime';
import { describe, expect, it } from 'vitest';
import { type FileApi, FileSaveStorage, saveFileName } from '../src/file-saves.js';

function memoryFiles(
  initial: Record<string, string> = {},
): FileApi & { files: Map<string, string> } {
  const files = new Map(Object.entries(initial));
  return {
    files,
    list: async () => [...files.keys()],
    read: async (name) => {
      const text = files.get(name);
      if (text === undefined) throw new Error(`no ${name}`);
      return text;
    },
    write: async (name, text) => void files.set(name, text),
    remove: async (name) => void files.delete(name),
  };
}

describe('FileSaveStorage', () => {
  it('writes each key to its own file and reads them back on the next start', async () => {
    const files = memoryFiles();
    const storage = await FileSaveStorage.open(files);
    storage.setItem('freequest:game:demo:save:1', '{"a":1}');
    storage.setItem('freequest:game:demo:save:2', '{"b":2}');
    storage.removeItem('freequest:game:demo:save:2');
    expect(storage.getItem('freequest:game:demo:save:1')).toBe('{"a":1}');
    await storage.flush();
    expect([...files.files.keys()]).toEqual(['freequest_game_demo_save_1.json']);

    const reopened = await FileSaveStorage.open(files);
    expect(reopened.getItem('freequest:game:demo:save:1')).toBe('{"a":1}');
    expect(reopened.getItem('freequest:game:demo:save:2')).toBeNull();
  });

  it('skips damaged files and reports failed writes without throwing', async () => {
    const errors: unknown[] = [];
    const files = memoryFiles({ 'broken.json': '{nope', 'notes.txt': 'ignored' });
    const storage = await FileSaveStorage.open(files, (e) => errors.push(e));
    expect(errors).toHaveLength(1);
    files.write = () => Promise.reject(new Error('disk full'));
    storage.setItem('k', 'v');
    await storage.flush();
    expect(errors).toHaveLength(2);
    expect(storage.getItem('k')).toBe('v');
  });

  it('works under SaveStore like any storage', async () => {
    const storage = await FileSaveStorage.open(memoryFiles());
    const store = new SaveStore(storage, { id: 'demo', name: 'Demo' });
    expect(store.list().map((s) => s.kind)).toEqual(['empty', 'empty', 'empty']);
    expect(new SaveStore(new MemoryStorage(), { id: 'x', name: 'X' }).read(1).kind).toBe('empty');
  });

  it('names files safely', () => {
    expect(saveFileName('freequest:game:my-game:save:3')).toBe(
      'freequest_game_my-game_save_3.json',
    );
  });
});
