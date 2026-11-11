import { describe, expect, it } from 'vitest';
import { DATABASE_FORMAT_VERSION, SCHEMAS } from '@freequest/schema';
import Value from 'typebox/value';
import {
  ENTRY_KINDS,
  addEntry,
  asSchema,
  classify,
  defaultFor,
  duplicateEntry,
  entrySchema,
  idProblem,
  moveEntry,
  newEntry,
  removeEntry,
  replaceEntry,
  slugify,
  uniqueId,
  variantLabel,
} from '../src/index.js';

const file = {
  formatVersion: 3,
  entries: [
    { id: 'potion', name: 'Potion' },
    { id: 'ether', name: 'Ether' },
  ],
};

/** A reference for every id field a database entry can have. */
const pick = (field: string) =>
  ({
    class: 'warrior',
    character: 'hero',
    skill: 'attack',
    state: 'poison',
    element: 'fire',
    equipmentType: 'sword',
    slot: 'weapon',
    enemies: 'slime',
    id: 'potion',
  })[field];

describe('database entries', () => {
  it('makes ids from names', () => {
    expect(slugify('Fire Ball!')).toBe('fire-ball');
    expect(slugify('  Ünïcode Sword ')).toBe('unicode-sword');
    expect(slugify('!!!')).toBe('entry');
    expect(uniqueId('potion', ['potion', 'potion-2'])).toBe('potion-3');
    expect(uniqueId('elixir', ['potion'])).toBe('elixir');
    expect(idProblem('Bad Id', file)).toMatch(/lowercase/);
    expect(idProblem('potion', file)).toMatch(/already used/);
    expect(idProblem('hi-potion', file)).toBeNull();
  });

  it('creates a valid new entry for every category', () => {
    for (const kind of ENTRY_KINDS) {
      const entry = newEntry(kind, 'new-one', 'New one', pick);
      const data = { formatVersion: DATABASE_FORMAT_VERSION, entries: [entry] };
      expect(Value.Check(SCHEMAS[kind], data), `${kind}: ${JSON.stringify(entry)}`).toBe(true);
    }
  });

  it('adds, duplicates, replaces, moves and removes', () => {
    const added = addEntry(file, { id: 'elixir', name: 'Elixir' }, 'potion');
    expect(added.entries.map((e) => e.id)).toEqual(['potion', 'elixir', 'ether']);
    expect(() => addEntry(file, { id: 'potion', name: 'Again' })).toThrow(/already used/);

    const copy = duplicateEntry(added, 'potion');
    expect(copy.id).toBe('potion-copy');
    expect(copy.file.entries.map((e) => e.name)).toEqual([
      'Potion',
      'Potion (copy)',
      'Elixir',
      'Ether',
    ]);

    const renamed = replaceEntry(file, 'ether', { id: 'ether', name: 'Magic water' });
    expect(renamed.entries[1]?.name).toBe('Magic water');
    expect(replaceEntry(file, 'ether', file.entries[1] as never)).toBe(file);
    expect(() => replaceEntry(file, 'ether', { id: 'other', name: 'x' })).toThrow(/id/);

    expect(moveEntry(file, 'ether', -1).entries.map((e) => e.id)).toEqual(['ether', 'potion']);
    expect(moveEntry(file, 'ether', 1)).toBe(file);
    expect(removeEntry(file, 'potion').entries.map((e) => e.id)).toEqual(['ether']);
    expect(() => removeEntry(file, 'nope')).toThrow(/no entry/);
  });

  it('reads level curves and slot maps as records', () => {
    const stats = entrySchema('classes').properties?.['stats']?.properties?.['maxHp'] ?? {};
    expect(classify(stats)).toMatchObject({ kind: 'record', keys: 'integer' });
    expect(defaultFor(stats)).toEqual({ '1': 0 });
    const equipment = entrySchema('actors').properties?.['equipment'] ?? {};
    expect(classify(equipment)).toMatchObject({ kind: 'record', keys: 'string' });
    expect(defaultFor(equipment)).toEqual({});
  });

  it('labels a modifier variant that covers several types', () => {
    const modifiers = entrySchema('states').properties?.['modifiers']?.items?.anyOf ?? [];
    expect(modifiers.map(variantLabel)).toContain('hitRate / evasionRate / criticalRate');
    expect(asSchema(SCHEMAS.system).properties?.['currency']?.minLength).toBe(1);
    const targets = entrySchema('items').properties?.['target']?.anyOf ?? [];
    expect(targets.map(variantLabel)).toEqual([
      'none',
      'user',
      'ally / enemy · one / all',
      'enemy · random',
    ]);
  });
});
