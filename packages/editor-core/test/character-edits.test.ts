import type { CharacterSheet } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import {
  MANIFEST_PATH,
  ProjectDocument,
  characterPath,
  characterUsages,
  createCharacter,
  defaultIdleFrame,
  defaultWalkCycle,
  deleteCharacter,
  fitCharacter,
  frameGrid,
  moveRow,
  openProject,
  parseFrameList,
  sheetImageProblem,
} from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const hero: CharacterSheet = {
  formatVersion: 1,
  id: 'hero',
  name: 'Hero',
  image: 'assets/characters/hero.png',
  frameWidth: 32,
  frameHeight: 32,
  frames: 3,
  rows: ['down', 'left', 'right', 'up'],
  idleFrame: 1,
  walkCycle: [0, 1, 2, 1],
};

async function demo() {
  const fs = await memoryCopy(DEMO);
  return new ProjectDocument(await openProject(fs));
}

const sample = {
  name: 'Knight',
  image: 'assets/characters/hero.png',
  imageWidth: 96,
  imageHeight: 128,
  frameWidth: 32,
  frameHeight: 32,
};

describe('character sheets', () => {
  it('has sensible defaults per frame count', () => {
    expect(defaultWalkCycle(3)).toEqual([0, 1, 2, 1]);
    expect(defaultWalkCycle(4)).toEqual([0, 1, 2, 3]);
    expect(defaultWalkCycle(1)).toEqual([0]);
    expect(defaultIdleFrame(3)).toBe(1);
    expect(defaultIdleFrame(4)).toBe(0);
    expect(frameGrid(96, 128, 32, 32)).toEqual({ frames: 3, rows: 4 });
  });

  it('checks the image holds the sheet', () => {
    expect(sheetImageProblem(hero, 96, 128)).toBeNull();
    expect(sheetImageProblem(hero, 96, 96)).toMatch(/3 rows .* needs 4/);
    expect(sheetImageProblem(hero, 64, 128)).toMatch(/2 frames wide, but the sheet uses 3/);
  });

  it('re-cuts frames, keeping frame numbers that still exist', () => {
    expect(fitCharacter(hero, 96, 128)).toBe(hero);
    const wide = fitCharacter(hero, 128, 128);
    expect(wide).toMatchObject({ frames: 4, idleFrame: 1, walkCycle: [0, 1, 2, 1] });
    const narrow = fitCharacter(hero, 96, 192, 48, 48);
    expect(narrow).toMatchObject({ frames: 2, frameWidth: 48, idleFrame: 1, walkCycle: [0, 1] });
    expect(fitCharacter({ ...hero, idleFrame: 2 }, 32, 128).idleFrame).toBe(0);
  });

  it('reads walk cycles typed by hand', () => {
    expect(parseFrameList('0 1, 2  1', 3)).toEqual({ value: [0, 1, 2, 1] });
    expect(parseFrameList('', 3)).toEqual({ problem: 'List at least one frame' });
    expect(parseFrameList('0 x', 3)).toEqual({ problem: '"x" isn\'t a frame number' });
    expect(parseFrameList('0 3', 3)).toEqual({ problem: "Frame 3 doesn't exist (0 to 2)" });
  });

  it('reorders direction rows', () => {
    expect(moveRow(hero, 0, 1).rows).toEqual(['left', 'down', 'right', 'up']);
    expect(moveRow(hero, 3, 1)).toBe(hero);
    expect(moveRow(hero, 0, -1)).toBe(hero);
  });
});

describe('character files', () => {
  it('lists everything that shows a character', async () => {
    const doc = await demo();
    expect(characterUsages(doc.project, 'hero')).toEqual(
      expect.arrayContaining(['the player', 'actor Hero']),
    );
    expect(characterUsages(doc.project, 'villager').some((u) => u.includes('event'))).toBe(true);
  });

  it('creates a sheet from an image in one undo step', async () => {
    const doc = await demo();
    const id = createCharacter(doc, sample);
    expect(id).toBe('knight');
    const file = doc.project.characters.get(id);
    expect(file?.path).toBe(characterPath(id));
    expect(file?.data).toMatchObject({ frames: 3, idleFrame: 1, walkCycle: [0, 1, 2, 1] });
    expect(doc.project.problems).toEqual([]);
    doc.undo();
    expect(doc.project.characters.has(id)).toBe(false);
    expect(doc.isDirty(MANIFEST_PATH)).toBe(false);
  });

  it('refuses images too small for four directions', async () => {
    const doc = await demo();
    expect(() => createCharacter(doc, { ...sample, imageHeight: 96 })).toThrow(/4 rows/);
    expect(() => createCharacter(doc, { ...sample, name: '' })).toThrow(/name/);
    expect(() => createCharacter(doc, { ...sample, frameWidth: 1.5 })).toThrow(/whole/);
  });

  it('deletes only unused characters', async () => {
    const doc = await demo();
    expect(() => deleteCharacter(doc, 'hero')).toThrow(/the player/);
    const id = createCharacter(doc, sample);
    deleteCharacter(doc, id);
    expect(doc.project.characters.has(id)).toBe(false);
  });

  it('reports frames past the end of a sheet', async () => {
    const doc = await demo();
    doc.update(characterPath('hero'), 'character', 'Break', (c) => ({ ...c, idleFrame: 5 }));
    expect(doc.project.problems.map((p) => p.message)).toEqual([
      'standing frame 5 is past the last frame (2)',
    ]);
  });
});
