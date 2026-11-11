import { describe, expect, it } from 'vitest';
import {
  MemoryFs,
  ProjectDocument,
  assetReferences,
  openProject,
  planExport,
  writeExport,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

async function demo() {
  const fs = await memoryCopy(DEMO);
  return { fs, project: await openProject(fs) };
}

/** A MemoryFs holding just the files under `prefix/` of another, with the prefix removed. */
function unprefixed(fs: MemoryFs, prefix: string): MemoryFs {
  const out = new MemoryFs({}, 'export');
  for (const [path, text] of fs.files) {
    if (path.startsWith(`${prefix}/`)) out.files.set(path.slice(prefix.length + 1), text);
  }
  for (const [path, bytes] of fs.binaries) {
    if (path.startsWith(`${prefix}/`)) out.binaries.set(path.slice(prefix.length + 1), bytes);
  }
  return out;
}

describe('assetReferences', () => {
  it('finds every image and sound the demo uses, and where', async () => {
    const { fs, project } = await demo();
    const refs = assetReferences(project);
    // The demo has no unused files, so this is everything under assets/.
    expect([...refs.keys()]).toEqual(await fs.list('assets'));
    expect(refs.get('assets/tilesets/overworld.png')).toEqual({
      kind: 'image',
      usedBy: ['tileset overworld'],
    });
    expect(refs.get('assets/audio/meadow.wav')?.usedBy).toEqual(['map Meadow: music']);
    expect(refs.get('assets/audio/sfx-heal.wav')?.usedBy).toEqual(
      expect.arrayContaining(['system sound heal']),
    );
    expect(refs.get('assets/enemies/wolf.png')?.usedBy).toEqual(['enemy Wolf']);
  });
});

describe('planExport', () => {
  it('plans the demo with no problems: all data files and the assets they use', async () => {
    const { fs, project } = await demo();
    await fs.writeBytes('assets/unused/old-sketch.png', new Uint8Array([1, 2, 3]));
    await fs.writeText('notes.txt', 'not part of the game');
    const plan = await planExport(project, fs);
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    const paths = plan.files.map((f) => f.path);
    expect(paths).toContain('project.json');
    expect(paths).toContain('data/maps/house.json');
    expect(paths).toContain('data/database/troops.json');
    expect(paths).toContain('assets/characters/mage.png');
    expect(paths).not.toContain('assets/unused/old-sketch.png');
    expect(paths).not.toContain('notes.txt');
    // project.json, 1 tileset, 2 maps, 3 characters, 9 database files.
    expect(plan.files.filter((f) => f.kind === 'data')).toHaveLength(17);
  });

  it('blocks on project problems and missing images, warns about missing sounds', async () => {
    const { fs } = await demo();
    fs.binaries.delete('assets/enemies/bat.png');
    fs.binaries.delete('assets/audio/victory.wav');
    const manifest = JSON.parse(await fs.readText('project.json')) as {
      switches: { id: string }[];
    };
    manifest.switches = manifest.switches.filter((s) => s.id !== 'rewarded');
    fs.files.set('project.json', JSON.stringify(manifest));

    const plan = await planExport(await openProject(fs), fs);
    expect(plan.errors.map((p) => p.source)).toEqual(
      expect.arrayContaining(['references', 'assets/enemies/bat.png']),
    );
    expect(plan.errors.find((p) => p.source === 'assets/enemies/bat.png')?.message).toBe(
      'image not found (used by enemy Bat)',
    );
    expect(plan.warnings).toEqual([
      {
        source: 'assets/audio/victory.wav',
        message: 'sound not found (used by system victoryMusic)',
      },
    ]);
    await expect(writeExport(plan, fs, new MemoryFs())).rejects.toThrow(/problems/);
  });

  it('includes unsaved edits from the document', async () => {
    const { fs, project } = await demo();
    const doc = new ProjectDocument(project);
    doc.update('data/maps/map001.json', 'map', 'Rename', (m) => ({ ...m, name: 'Edited' }));
    const plan = await planExport(doc.project, fs);
    const map = plan.files.find((f) => f.path === 'data/maps/map001.json');
    expect(map?.kind === 'data' && (map.data as { name: string }).name).toBe('Edited');
  });
});

describe('writeExport', () => {
  it('writes a compact copy that opens as the same project', async () => {
    const { fs, project } = await demo();
    const plan = await planExport(project, fs);
    const target = new MemoryFs({}, 'out');
    const progress: string[] = [];
    const result = await writeExport(plan, fs, target, {
      prefix: 'game',
      onProgress: (p) => progress.push(`${p.done}/${p.total}`),
    });
    expect(result.files).toBe(plan.files.length);
    expect(progress.at(-1)).toBe(`${plan.files.length}/${plan.files.length}`);
    expect(result.bytes).toBeGreaterThan(1000);

    // Compact JSON, project.json written last, assets byte for byte.
    const map = await target.readText('game/data/maps/map001.json');
    expect(map).not.toContain('\n');
    expect([...target.files.keys()].at(-1)).toBe('game/project.json');
    expect(await target.readBytes('game/assets/tilesets/overworld.png')).toEqual(
      await fs.readBytes('assets/tilesets/overworld.png'),
    );

    const exported = await openProject(unprefixed(target, 'game'));
    expect(exported.problems).toEqual([]);
    expect(exported.maps.get('house')?.data).toEqual(project.maps.get('house')?.data);
    expect((await planExport(exported, unprefixed(target, 'game'))).errors).toEqual([]);
  });
});

describe('utf8', () => {
  it('round-trips text of every width and measures it', async () => {
    const { decodeUtf8, encodeUtf8, utf8Length } = await import('../src/index.js');
    const text = 'Hé “quest” ⚔ 🐉';
    const bytes = encodeUtf8(text);
    expect(Array.from(bytes)).toEqual(Array.from(Buffer.from(text, 'utf8')));
    expect(decodeUtf8(bytes)).toBe(text);
    expect(utf8Length(text)).toBe(Buffer.byteLength(text, 'utf8'));
    expect(decodeUtf8(Uint8Array.from([0x41, 0xff, 0x42]))).toBe('A�B');
  });
});
