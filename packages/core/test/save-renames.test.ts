import { type Manifest, type SaveFile, emptyDatabase } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { DatabaseIndex, translateSave } from '../src/index.js';

/** A project after some renames (old → new), and a save made before them. */
const manifest = {
  maps: [{ id: 'elders-house', path: 'x' }],
  switches: [
    { id: 'quest-accepted', name: 'Q' },
    { id: 'door', name: 'D' },
  ],
  variables: [{ id: 'coins', name: 'C' }],
  renames: {
    map: { house: 'elders-house' },
    switch: { accepted: 'quest-accepted', door: 'gate' },
    item: { potion: 'red-potion' },
    actor: { mira: 'mira-the-mage' },
    equipmentSlot: { weapon: 'main-hand' },
    event: { 'house/chest': 'house/old-chest' },
  },
} as unknown as Manifest;

const db = new DatabaseIndex({
  ...emptyDatabase(),
  items: [{ id: 'red-potion' }],
  actors: [{ id: 'mira-the-mage' }],
  system: { ...emptyDatabase().system, equipmentSlots: [{ id: 'main-hand', name: 'Hand' }] },
} as never);

const save = {
  formatVersion: 2,
  game: 'g',
  savedAt: '',
  playSeconds: 1,
  map: 'house',
  x: 1,
  y: 1,
  direction: 'down',
  switches: { accepted: true, door: true },
  variables: { coins: 3 },
  flags: { house: { chest: ['opened'] } },
  party: {
    members: [
      {
        id: 'mira',
        level: 1,
        exp: 0,
        hp: 1,
        mp: 0,
        equipment: { weapon: 'staff' },
        extraSkills: [],
        states: [],
      },
    ],
    gold: 0,
    items: { potion: 2 },
    equipment: {},
    steps: 0,
  },
  summary: { location: 'House', members: [] },
} as SaveFile;

describe('translating saves after renames', () => {
  it('moves every stored id to its new name', () => {
    const out = translateSave(save, manifest, db);
    expect(out.map).toBe('elders-house');
    expect(out.flags).toEqual({ 'elders-house': { 'old-chest': ['opened'] } });
    expect(out.party.items).toEqual({ 'red-potion': 2 });
    expect(out.party.members[0]).toMatchObject({
      id: 'mira-the-mage',
      equipment: { 'main-hand': 'staff' },
    });
    expect(out.variables).toEqual({ coins: 3 });
    expect(out.switches).toMatchObject({ 'quest-accepted': true });
  });

  it('keeps an id that exists now, even if it was once renamed away', () => {
    // "door" was renamed to "gate", but a new switch called "door" exists now.
    expect(translateSave(save, manifest, db).switches).toEqual({
      'quest-accepted': true,
      door: true,
    });
  });

  it('changes nothing without renames, and twice is the same as once', () => {
    expect(translateSave(save, { ...manifest, renames: undefined } as never, db)).toBe(save);
    const once = translateSave(save, manifest, db);
    expect(translateSave(once, manifest, db)).toEqual(once);
  });
});
