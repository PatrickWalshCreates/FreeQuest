import { describe, expect, it } from 'vitest';
import {
  ASSET_FOLDERS,
  AssetLibrary,
  ProjectDocument,
  assetType,
  describeAssets,
  importFolderFor,
  importProblem,
  openProject,
  pngSize,
  safeAssetName,
  sniffFormat,
  uniqueAssetPath,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const bytes = (...parts: (string | number[])[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

/** The smallest header that sniffs as a PNG of the given size. */
function png(width = 32, height = 16): Uint8Array {
  const out = bytes(
    [0x89],
    'PNG',
    [0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13],
    'IHDR',
    new Array(8).fill(0),
  );
  const view = new DataView(out.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return out;
}
const wav = () => bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt ');

async function demo() {
  const fs = await memoryCopy(DEMO);
  const project = await openProject(fs);
  return { fs, project, doc: new ProjectDocument(project) };
}

describe('asset files', () => {
  it('knows types by extension and formats by contents', () => {
    expect(assetType('a/b.PNG')).toBe('image');
    expect(assetType('song.ogg')).toBe('audio');
    expect(assetType('notes.txt')).toBeNull();
    expect(sniffFormat(png())).toBe('png');
    expect(sniffFormat(wav())).toBe('wav');
    expect(sniffFormat(bytes('OggS'))).toBe('ogg');
    expect(sniffFormat(bytes('ID3'))).toBe('mp3');
    expect(sniffFormat(bytes([0xff, 0xd8, 0xff]))).toBe('jpeg');
    expect(sniffFormat(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('webp');
    expect(sniffFormat(bytes('hello'))).toBeNull();
    expect(pngSize(png(48, 96))).toEqual({ width: 48, height: 96 });
    expect(pngSize(wav())).toBeNull();
  });

  it('reads the size of the demo tileset', async () => {
    const { fs } = await demo();
    expect(pngSize(await fs.readBytes('assets/tilesets/overworld.png'))).not.toBeNull();
  });

  it('explains files it refuses', () => {
    expect(importProblem('a.png', png())).toBeNull();
    expect(importProblem('a.txt', bytes('hi'))).toMatch(/not a supported file/);
    expect(importProblem('a.png', new Uint8Array())).toMatch(/empty/);
    expect(importProblem('a.png', wav())).toMatch(/aren't PNG \(it looks like WAV\)/);
    expect(importProblem('a.wav', bytes('nonsense'))).toMatch(/aren't WAV$/);
  });

  it('makes safe, unique names', () => {
    expect(safeAssetName('C:\\pics\\My  Hero?.PNG')).toBe('My Hero-.png');
    expect(safeAssetName('../../.hidden.png')).toBe('hidden.png');
    expect(safeAssetName('.png')).toBe('asset.png');
    expect(uniqueAssetPath('assets/audio', 'song.wav', [])).toBe('assets/audio/song.wav');
    expect(
      uniqueAssetPath('assets/audio', 'song.wav', [
        'assets/audio/Song.wav',
        'assets/audio/song-2.wav',
      ]),
    ).toBe('assets/audio/song-3.wav');
  });

  it('offers a folder for every kind of asset', () => {
    expect(ASSET_FOLDERS.map((f) => f.path)).toContain('assets/audio');
    for (const f of ASSET_FOLDERS) expect(f.path.startsWith('assets/')).toBe(true);
  });

  it('sends each file to a folder for its type', () => {
    expect(importFolderFor('a.png', 'assets/characters')).toBe('assets/characters');
    expect(importFolderFor('a.wav', 'assets/characters')).toBe('assets/audio');
    expect(importFolderFor('a.png', 'assets/audio')).toBe('assets/tilesets');
    expect(importFolderFor('a.txt', 'assets/audio')).toBe('assets/audio');
  });
});

describe('AssetLibrary', () => {
  it('lists the demo with where each file is used', async () => {
    const { doc } = await demo();
    const entries = describeAssets(doc.project, await doc.assets.list());
    const tileset = entries.find((e) => e.path === 'assets/tilesets/overworld.png');
    expect(tileset).toMatchObject({ type: 'image', missing: false });
    expect(tileset?.usedBy.length).toBeGreaterThan(0);
    expect(entries.every((e) => !e.missing)).toBe(true);
  });

  it('marks referenced files that are gone as missing', async () => {
    const { fs } = await demo();
    await fs.remove('assets/audio/meadow.wav');
    const project = await openProject(fs);
    const library = new AssetLibrary(fs);
    const entry = describeAssets(project, await library.list()).find(
      (e) => e.path === 'assets/audio/meadow.wav',
    );
    expect(entry).toMatchObject({ missing: true, type: 'audio' });
  });

  it('imports good files, numbers clashes, rejects bad ones and notifies', async () => {
    const { fs, doc } = await demo();
    let notified = 0;
    doc.assets.subscribe(() => notified++);
    await doc.assets.list();
    const before = notified;
    const result = await doc.assets.import('assets/tilesets', [
      { name: 'overworld.png', bytes: png() },
      { name: 'caves.png', bytes: png() },
      { name: 'readme.txt', bytes: bytes('hi') },
      { name: 'fake.png', bytes: wav() },
    ]);
    expect(result.imported.map((i) => i.path)).toEqual([
      'assets/tilesets/overworld-2.png',
      'assets/tilesets/caves.png',
    ]);
    expect(result.rejected.map((r) => r.name)).toEqual(['readme.txt', 'fake.png']);
    expect(fs.binaries.get('assets/tilesets/caves.png')).toEqual(png());
    expect(await doc.assets.list()).toContain('assets/tilesets/caves.png');
    expect(notified).toBe(before + 1);
  });

  it('only imports under assets/', async () => {
    const { doc } = await demo();
    await expect(doc.assets.import('data', [{ name: 'a.png', bytes: png() }])).rejects.toThrow(
      /under assets/,
    );
    await expect(doc.assets.import('../x', [{ name: 'a.png', bytes: png() }])).rejects.toThrow();
  });

  it('deletes unused files and refuses used ones', async () => {
    const { fs, doc } = await demo();
    await doc.assets.import('assets/images', [{ name: 'spare.png', bytes: png() }]);
    await doc.assets.remove(doc.project, 'assets/images/spare.png');
    expect(fs.binaries.has('assets/images/spare.png')).toBe(false);
    expect(await doc.assets.list()).not.toContain('assets/images/spare.png');
    await expect(doc.assets.remove(doc.project, 'assets/tilesets/overworld.png')).rejects.toThrow(
      /still used by tileset/,
    );
  });

  it('sees files changed outside the editor after a refresh', async () => {
    const { fs, doc } = await demo();
    await doc.assets.list();
    await fs.writeBytes('assets/audio/new.wav', wav());
    expect(await doc.assets.list()).not.toContain('assets/audio/new.wav');
    expect(await doc.assets.refresh()).toContain('assets/audio/new.wav');
  });
});
