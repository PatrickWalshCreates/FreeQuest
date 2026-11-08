import { describe, expect, it } from 'vitest';
import {
  type ActorEntry,
  type ClassEntry,
  type Database,
  type EquipmentEntry,
  type Manifest,
  STAT_KEYS,
  assembleDatabase,
  checkDatabase,
  emptyDatabase,
  emptySystem,
} from '../src/index.js';

const flatCurve = Object.fromEntries(
  STAT_KEYS.map((s) => [s, { 1: 10 }]),
) as unknown as ClassEntry['stats'];

function db(overrides: Partial<Database> = {}): Database {
  const system = {
    ...emptySystem(),
    elements: [{ id: 'fire', name: 'Fire' }],
    equipmentSlots: [{ id: 'weapon', name: 'Weapon' }],
    equipmentTypes: [{ id: 'sword', name: 'Sword' }],
  };
  const fighter: ClassEntry = {
    id: 'fighter',
    name: 'Fighter',
    exp: { base: 30, exponent: 2 },
    stats: flatCurve,
    skills: [],
    modifiers: [{ type: 'equipType', equipmentType: 'sword' }],
  };
  const sword: EquipmentEntry = {
    id: 'sword',
    name: 'Sword',
    price: 10,
    slot: 'weapon',
    equipmentType: 'sword',
    modifiers: [],
  };
  const hero: ActorEntry = {
    id: 'hero',
    name: 'Hero',
    class: 'fighter',
    character: 'hero',
    level: 1,
    maxLevel: 99,
    equipment: { weapon: 'sword' },
    modifiers: [],
  };
  return {
    ...emptyDatabase(),
    system,
    classes: [fighter],
    equipment: [sword],
    actors: [hero],
    ...overrides,
  };
}

describe('checkDatabase', () => {
  it('accepts a consistent database', () => {
    expect(checkDatabase(db())).toEqual([]);
  });

  it('accepts an empty database', () => {
    expect(checkDatabase(emptyDatabase())).toEqual([]);
  });

  it('reports duplicate ids', () => {
    const d = db();
    expect(checkDatabase({ ...d, actors: [...d.actors, ...d.actors] })).toEqual([
      'actors: duplicate id "hero"',
    ]);
  });

  it('requires level 1 on every stat curve', () => {
    const d = db();
    const fighter = d.classes[0];
    if (!fighter) throw new Error('fixture');
    const classes = [{ ...fighter, stats: { ...fighter.stats, luck: { 5: 3 } } }];
    expect(checkDatabase({ ...d, classes })).toEqual([
      'classes "fighter" stats.luck: must define level 1',
    ]);
  });

  it('checks starting equipment: slot, item and allowed type', () => {
    const d = db();
    const hero = d.actors[0];
    if (!hero) throw new Error('fixture');
    const actors = [{ ...hero, equipment: { weapon: 'nope', shield: 'sword' } }];
    expect(checkDatabase({ ...d, actors })).toEqual([
      'actors "hero" equipment.weapon: unknown equipment "nope"',
      'actors "hero" equipment: unknown equipment slot "shield"',
      'actors "hero" equipment.shield: "sword" goes in slot "weapon"',
    ]);
    const classes = d.classes.map((c) => ({ ...c, modifiers: [] }));
    expect(checkDatabase({ ...d, classes })).toEqual([
      'actors "hero" equipment.weapon: cannot equip type "sword" (no equipType modifier)',
    ]);
  });

  it('checks references inside effects and modifiers', () => {
    const problems = checkDatabase(
      db({
        items: [
          {
            id: 'bomb',
            name: 'Bomb',
            price: 0,
            key: false,
            consumable: true,
            occasion: 'battle',
            target: { side: 'enemy', select: 'all' },
            hitType: 'certain',
            successRate: 1,
            effects: [
              {
                type: 'damage',
                pool: 'hp',
                formula: '100',
                element: 'acid',
                variance: 0,
                critical: false,
              },
              { type: 'addState', state: 'burn', chance: 1 },
            ],
          },
        ],
      }),
    );
    expect(problems).toEqual([
      'items "bomb" effects[0]: unknown element "acid"',
      'items "bomb" effects[1]: unknown state "burn"',
    ]);
  });

  it('runs the formula checker on damage and recover formulas', () => {
    const d = db({
      skills: [
        {
          id: 'heal',
          name: 'Heal',
          mpCost: 1,
          occasion: 'always',
          target: { side: 'user' },
          hitType: 'certain',
          successRate: 1,
          effects: [{ type: 'recover', pool: 'hp', formula: '10 +' }],
        },
      ],
    });
    const problems = checkDatabase(d, {
      checkFormula: (f) => (f.endsWith('+') ? 'unexpected end' : null),
    });
    expect(problems).toEqual(['skills "heal" effects[0]: formula "10 +": unexpected end']);
  });

  it('checks the starting party against actors', () => {
    const manifest: Manifest = {
      formatVersion: 4,
      name: 'T',
      screen: { width: 1, height: 1 },
      start: { map: 'a', x: 0, y: 0, direction: 'down', party: ['hero', 'ghost'], gold: 0 },
      player: { character: 'hero', speed: 4 },
      tilesets: [],
      maps: [],
      characters: [],
      switches: [],
      variables: [],
    };
    expect(checkDatabase(db(), { manifest })).toEqual([
      'project.json start.party: unknown actor "ghost"',
    ]);
  });
});

describe('checkDatabase battle data', () => {
  it('checks troop members and the attack/guard skills', () => {
    const d = db({
      troops: [{ id: 'pack', name: 'Pack', enemies: ['wolf'] }],
      system: { ...db().system, attackSkill: 'attack' },
    });
    expect(checkDatabase(d)).toEqual([
      'system attackSkill: unknown skill "attack"',
      'troops "pack" enemies[0]: unknown enemy "wolf"',
    ]);
  });
});

describe('assembleDatabase', () => {
  it('treats missing files as empty categories', () => {
    const d = assembleDatabase({ items: { formatVersion: 1, entries: [] } });
    expect(d.actors).toEqual([]);
    expect(d.system.currency).toBe('G');
  });
});
