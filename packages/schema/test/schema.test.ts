import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORMAT_VERSION,
  DATABASE_KINDS,
  type DatabaseFiles,
  assembleDatabase,
  checkDatabase,
  type FileKind,
  FormatVersionError,
  idFromName,
  type Migration,
  ProjectFileError,
  type ProjectData,
  checkMapShape,
  checkReferences,
  migrate,
  parseProjectFile,
  stableStringify,
} from '../src/index.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');
const FIXTURES = join(import.meta.dirname, 'fixtures');

describe('stableStringify', () => {
  it('orders formatVersion, id, name first and the rest alphabetically', () => {
    const out = stableStringify({ zeta: 1, name: 'n', alpha: 2, formatVersion: 1, id: 'x' });
    expect(out).toBe(
      '{\n  "formatVersion": 1,\n  "id": "x",\n  "name": "n",\n  "alpha": 2,\n  "zeta": 1\n}\n',
    );
  });

  it('puts large nested blocks last', () => {
    const out = stableStringify({ commands: [], trigger: 'action', conditions: [], label: 'x' });
    expect(Object.keys(JSON.parse(out) as object)).toEqual([
      'label',
      'conditions',
      'trigger',
      'commands',
    ]);
  });

  it('keeps primitive arrays on one line and nests others', () => {
    expect(stableStringify({ data: [[1, 2], [3]] })).toBe(
      '{\n  "data": [\n    [1, 2],\n    [3]\n  ]\n}\n',
    );
  });

  it('is independent of input key order', () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: 2 } })).toBe(
      stableStringify({ a: { c: 2, d: 1 }, b: 1 }),
    );
  });

  it('sorts integer keys numerically', () => {
    expect(stableStringify({ '10': 3, '5': 2, '99': 4, '1': 1 })).toBe(
      '{\n  "1": 1,\n  "5": 2,\n  "10": 3,\n  "99": 4\n}\n',
    );
  });

  it('omits undefined values', () => {
    expect(stableStringify({ a: undefined, b: 1 })).toBe('{\n  "b": 1\n}\n');
  });
});

describe('migrate', () => {
  it('passes current-version data through', () => {
    const data = { formatVersion: CURRENT_FORMAT_VERSION.map, x: 1 };
    expect(migrate('map', data)).toBe(data);
  });

  it.each([
    ['manifest', 'project.json'],
    ['map', 'map001.json'],
  ] as const)('upgrades a v1 %s (%s) to the current format', (kind, file) => {
    const raw: unknown = JSON.parse(readFileSync(join(FIXTURES, 'v1', file), 'utf8'));
    const data = parseProjectFile(kind, raw, file);
    expect(data.formatVersion).toBe(CURRENT_FORMAT_VERSION[kind]);
  });

  it('gives a v4 manifest a game id made from its name', () => {
    const raw: unknown = JSON.parse(readFileSync(join(FIXTURES, 'v4', 'project.json'), 'utf8'));
    const manifest = parseProjectFile('manifest', raw, 'project.json');
    expect(manifest.formatVersion).toBe(5);
    expect(manifest.id).toBe('freequest-demo');
    // Names with nothing usable still get a valid id.
    const odd = parseProjectFile('manifest', { ...(raw as object), name: '★★★' });
    expect(odd.id).toBe('game');
  });

  it('reads a v5 map (before event movement) unchanged as v6', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'v5', 'map001.json'), 'utf8')) as object;
    const map = parseProjectFile('map', raw, 'map001.json');
    expect(map.formatVersion).toBe(6);
    expect({ ...map, formatVersion: 5 }).toEqual(raw);
  });

  it('gives v3 enemy actions an empty list of conditions', () => {
    const raw = JSON.parse(readFileSync(join(FIXTURES, 'v3', 'enemies.json'), 'utf8')) as {
      entries: { actions: object[] }[];
    };
    const data = parseProjectFile('enemies', raw, 'enemies.json');
    expect(data.formatVersion).toBe(4);
    const actions = data.entries.flatMap((e) => e.actions);
    expect(actions.length).toBe(raw.entries.flatMap((e) => e.actions).length);
    expect(actions.every((a) => Array.isArray(a.conditions) && a.conditions.length === 0)).toBe(
      true,
    );
    // Other database files pass through unchanged.
    expect(parseProjectFile('items', { formatVersion: 3, entries: [] }).formatVersion).toBe(4);
  });

  it('makes ids from names', () => {
    expect(idFromName('Fire Ball!')).toBe('fire-ball');
    expect(idFromName('  Ünïcode Sword ')).toBe('unicode-sword');
    expect(idFromName('!!!')).toBe('entry');
    expect(idFromName('!!!', 'game')).toBe('game');
  });

  it('rejects missing or future versions', () => {
    expect(() => migrate('map', { x: 1 })).toThrow(FormatVersionError);
    expect(() => migrate('map', { formatVersion: 999 })).toThrow(/newer/);
  });

  it('applies registered migrations in order', () => {
    const steps: Migration[] = [
      { from: 1, migrate: (d) => ({ ...d, a: 'added in 2' }) },
      { from: 2, migrate: (d) => ({ ...d, b: 'added in 3' }) },
    ];
    const registry: Partial<Record<FileKind, Migration[]>> = { map: steps };
    const original = { formatVersion: 1 };
    expect(migrate('map', original, registry, 3)).toEqual({
      formatVersion: 3,
      a: 'added in 2',
      b: 'added in 3',
    });
    expect(original).toEqual({ formatVersion: 1 });
    expect(() => migrate('map', original, { ...registry, map: [] }, 2)).toThrow(/no migration/);
  });
});

describe('parseProjectFile', () => {
  it('reports schema violations with paths', () => {
    try {
      parseProjectFile('tileset', { formatVersion: 1, id: 'Bad Id' }, 'x.json');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectFileError);
      expect((e as ProjectFileError).message).toMatch(/x\.json/);
    }
  });
});

describe('demo project', () => {
  const files: [FileKind, string][] = [['manifest', 'project.json']];
  for (const [dir, kind] of [
    ['tilesets', 'tileset'],
    ['maps', 'map'],
    ['characters', 'character'],
  ] as const) {
    for (const f of readdirSync(join(DEMO, 'data', dir))) files.push([kind, `data/${dir}/${f}`]);
  }
  const demoManifest = parseProjectFile(
    'manifest',
    JSON.parse(readFileSync(join(DEMO, 'project.json'), 'utf8')),
  );
  for (const kind of DATABASE_KINDS) {
    const path = demoManifest.database?.[kind];
    if (path) files.push([kind, path]);
  }

  it('has no broken references across all its files', () => {
    const load = (dir: string) =>
      readdirSync(join(DEMO, 'data', dir)).map((f) => join('data', dir, f));
    const read = (path: string): unknown => JSON.parse(readFileSync(join(DEMO, path), 'utf8'));
    const byId = <K extends FileKind>(kind: K, dir: string) =>
      new Map(
        load(dir).map((path) => {
          const data = parseProjectFile(kind, read(path), path) as { id: string };
          return [data.id, data] as const;
        }),
      );
    const project = {
      manifest: parseProjectFile('manifest', read('project.json')),
      maps: byId('map', 'maps'),
      tilesets: byId('tileset', 'tilesets'),
      characters: byId('character', 'characters'),
    } as unknown as ProjectData;
    expect(checkReferences(project)).toEqual([]);
    const databaseFiles = Object.fromEntries(
      DATABASE_KINDS.flatMap((kind) => {
        const path = project.manifest.database?.[kind];
        return path ? [[kind, parseProjectFile(kind, read(path), path)]] : [];
      }),
    ) as DatabaseFiles;
    const database = assembleDatabase(databaseFiles);
    expect(database.actors.length).toBeGreaterThan(0);
    expect(checkDatabase(database, project)).toEqual([]);
    expect(readdirSync(join(DEMO, 'data', 'database')).length).toBe(DATABASE_KINDS.length);
    const listed = (refs: { path: string }[]) => refs.map((r) => r.path).sort();
    expect(listed(project.manifest.maps)).toEqual(load('maps').sort());
  });

  it.each(files)('%s %s is valid and in canonical form', (kind, path) => {
    const text = readFileSync(join(DEMO, path), 'utf8');
    const data = parseProjectFile(kind, JSON.parse(text), relative(DEMO, join(DEMO, path)));
    expect(stableStringify(data)).toBe(text);
    if (kind === 'map') expect(checkMapShape(data as never)).toEqual([]);
  });
});

describe('demo assets', () => {
  it('every image and audio file a project file references exists', () => {
    const read = (path: string): unknown => JSON.parse(readFileSync(join(DEMO, path), 'utf8'));
    const files = [
      'project.json',
      ...['maps', 'tilesets', 'characters', 'database'].flatMap((dir) =>
        readdirSync(join(DEMO, 'data', dir)).map((f) => `data/${dir}/${f}`),
      ),
    ];
    // Asset references are the string values under these keys (and every playSound/playMusic path).
    const ASSET_KEYS = new Set([
      'image',
      'music',
      'path',
      'titleMusic',
      'battleMusic',
      'victoryMusic',
      'gameOverMusic',
    ]);
    const found: string[] = [];
    const visit = (value: unknown, key: string | null, parentKey: string | null): void => {
      if (typeof value === 'string') {
        if ((key && ASSET_KEYS.has(key) && value.startsWith('assets/')) || parentKey === 'sounds') {
          found.push(value);
        }
      } else if (Array.isArray(value)) {
        for (const v of value) visit(v, key, parentKey);
      } else if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value)) visit(v, k, key);
      }
    };
    for (const file of files) visit(read(file), null, null);
    expect(found.length).toBeGreaterThan(20);
    const missing = found.filter((path) => {
      try {
        readFileSync(join(DEMO, path));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });
});
