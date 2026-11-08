import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORMAT_VERSION,
  type FileKind,
  FormatVersionError,
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

  it('rejects missing or future versions', () => {
    expect(() => migrate('map', { x: 1 })).toThrow(FormatVersionError);
    expect(() => migrate('map', { formatVersion: 999 })).toThrow(/newer/);
  });

  it('applies registered migrations in order', () => {
    const steps: Migration[] = [
      { from: 1, migrate: (d) => ({ ...d, a: 'added in 2' }) },
      { from: 2, migrate: (d) => ({ ...d, b: 'added in 3' }) },
    ];
    const registry = { manifest: [], tileset: [], map: steps, character: [] } satisfies Record<
      FileKind,
      Migration[]
    >;
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
