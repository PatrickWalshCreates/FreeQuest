import { describe, expect, it } from 'vitest';
import {
  ProjectDocument,
  assetMoveProblem,
  assetReferences,
  moveAsset,
  openProject,
  projectReferences,
  usagesOf,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

async function demo() {
  const fs = await memoryCopy(DEMO);
  const doc = new ProjectDocument(await openProject(fs));
  await doc.assets.list();
  return { fs, doc };
}
const has = (fs: { binaries: Map<string, Uint8Array> }, path: string) => fs.binaries.has(path);

describe('moving assets', () => {
  it('knows every asset the export knows (the two lists must agree)', async () => {
    const { doc } = await demo();
    const indexed = new Set(
      projectReferences(doc.project)
        .filter((r) => r.kind === 'asset')
        .map((r) => r.id),
    );
    expect([...indexed].sort()).toEqual([...assetReferences(doc.project).keys()].sort());
  });

  it('renames a file and every reference, keeping the old file until a save', async () => {
    const { doc, fs } = await demo();
    const old = 'assets/characters/chest.png';
    const next = 'assets/characters/treasure-chest.png';
    const uses = usagesOf(doc.project, 'asset', old);
    expect(await moveAsset(doc, old, next)).toBe(uses.length);
    expect(usagesOf(doc.project, 'asset', next)).toEqual(uses);
    expect(usagesOf(doc.project, 'asset', old)).toEqual([]);
    expect(doc.project.problems).toEqual([]);
    expect([has(fs, old), has(fs, next)]).toEqual([true, true]);
    await doc.save();
    expect([has(fs, old), has(fs, next)]).toEqual([false, true]);
    expect(doc.assets.listed).toContain(next);
    expect(doc.assets.listed).not.toContain(old);
  });

  it('moves a sound to another folder, and an undone move drops the new copy on save', async () => {
    const { doc, fs } = await demo();
    const old = 'assets/audio/sfx-heal.wav';
    const next = 'assets/audio/sfx/heal.wav';
    await moveAsset(doc, old, next);
    expect(doc.project.problems).toEqual([]);
    doc.undo();
    await doc.save();
    expect([has(fs, old), has(fs, next)]).toEqual([true, false]);
  });

  it('refuses names that would lose or overwrite a file', async () => {
    const { doc } = await demo();
    const paths = await doc.assets.list();
    const from = 'assets/characters/chest.png';
    expect(assetMoveProblem(paths, from, 'assets/characters/Chest.png')).toMatch(/capitals/);
    expect(assetMoveProblem(paths, from, 'assets/characters/HERO.png')).toMatch(/already exists/);
    expect(assetMoveProblem(paths, from, 'assets/characters/chest.jpg')).toMatch(/\.png/);
    expect(assetMoveProblem(paths, from, 'data/chest.png')).toMatch(/under assets/);
    expect(assetMoveProblem(paths, from, 'assets/../x.png')).toMatch(/valid path|under assets/);
    expect(assetMoveProblem(paths, 'assets/nope.png', 'assets/x.png')).toMatch(/isn't in/);
    expect(assetMoveProblem(paths, from, 'assets/characters/box.png')).toBeNull();
    await expect(moveAsset(doc, from, 'assets/characters/hero.png')).rejects.toThrow(
      /already exists/,
    );
  });
});
