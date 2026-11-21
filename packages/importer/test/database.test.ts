import { MemoryFs, openProject } from '@freequest/editor-core';
import { describe, expect, it } from 'vitest';
import {
  ImportReport,
  NumberedIds,
  SystemTypes,
  importDatabase,
  importMzProject,
  levelCurve,
  readMzDatabase,
  readMzProject,
  translateFormula,
} from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

async function imported() {
  const fs = await memoryCopy(TINY);
  const report = new ImportReport();
  const mz = await readMzProject(fs, report);
  const db = await readMzDatabase(fs);
  const types = new SystemTypes(mz.system);
  const variables = new NumberedIds(mz.system.variables, 'variable', new Set());
  const result = importDatabase({
    db,
    types,
    variables,
    report,
    placeholderCharacter: 'hero',
    actorCharacter: () => null,
    enemyImage: () => null,
    usedPlaceholder: () => undefined,
    animation: (n) => db.animations.id(n),
    common: (n) => (n === 1 ? 'open-gate' : null),
  });
  const where = (name: string) =>
    report.items.filter((i) => i.where.endsWith(`› ${name}`)).map((i) => i.message);
  const find = <T extends { id: string }>(list: readonly T[], id: string): T => {
    const entry = list.find((e) => e.id === id);
    if (!entry) throw new Error(`no ${id}`);
    return entry;
  };
  return { result, report, where, find, types };
}

/** Straight lines between a curve's points, rounded (as the game reads curves). */
function valueAt(curve: Record<number, number>, level: number): number {
  const points = Object.entries(curve).map(([l, v]) => [Number(l), v] as const);
  for (let i = 1; i < points.length; i++) {
    const [l0, v0] = points[i - 1] ?? [0, 0];
    const [l1, v1] = points[i] ?? [0, 0];
    if (level <= l1) return Math.round(v0 + ((v1 - v0) * (level - l0)) / (l1 - l0));
  }
  return points.at(-1)?.[1] ?? 0;
}

describe('translating damage formulas', () => {
  const v = (n: number) => `var-${n}`;
  it('translates the shared subset', () => {
    expect(translateFormula('a.atk * 4 - b.def * 2', v)).toEqual({
      ok: true,
      formula: 'a.attack * 4 - b.defense * 2',
    });
    expect(
      translateFormula('Math.max(a.mhp / 4, b.mmp) + v[2] + $gameVariables.value(3);', v),
    ).toEqual({
      ok: true,
      formula: 'max(a.maxHp / 4, b.maxMp) + v["var-2"] + v["var-3"]',
    });
    expect(translateFormula('a.level === 1 ? Math.randomInt(10) : b.hp', v)).toEqual({
      ok: true,
      formula: 'a.level == 1 ? random(0, 9) : b.hp',
    });
  });

  it('says why it can’t translate the rest', () => {
    expect(translateFormula('b.addState(5); 100', v)).toMatchObject({
      ok: false,
      reason: /several statements/,
    });
    expect(translateFormula('a.isStateAffected(3) ? 2 : 1', v)).toMatchObject({
      ok: false,
      reason: /a\.isStateAffected\(\)/,
    });
    expect(translateFormula('Math.random() * 100', v)).toMatchObject({
      ok: false,
      reason: /Math\.random/,
    });
    expect(translateFormula('a.hit * 2', v)).toMatchObject({ ok: false, reason: /a\.hit/ });
    // TP is FreeQuest's too (from 0.5).
    expect(translateFormula('a.tp * 2', v)).toEqual({ ok: true, formula: 'a.tp * 2' });
    expect(translateFormula('mhp * 2', v)).toMatchObject({
      ok: false,
      reason: /unknown name "mhp"/,
    });
    expect(translateFormula('  ', v)).toMatchObject({ ok: false });
  });
});

describe('level curves', () => {
  it('keep only the points needed, every level within half a percent', () => {
    expect(levelCurve([0, 100, 110, 120, 130, 140])).toEqual({ 1: 100, 5: 140 });
    const values = [
      0,
      ...Array.from({ length: 99 }, (_, i) => Math.round(400 + 30 * (i + 1) + (i + 1) ** 2 / 3)),
    ];
    const curve = levelCurve(values);
    expect(Object.keys(curve).length).toBeLessThan(40);
    for (let level = 1; level <= 99; level++) {
      const want = values[level] ?? 0;
      expect(Math.abs(valueAt(curve, level) - want)).toBeLessThanOrEqual(Math.max(1, want * 0.005));
    }
    expect(levelCurve([])).toEqual({ 1: 1 });
  });
});

describe('importing the database', () => {
  it('imports states, with knockout, guard and what FreeQuest does differently', async () => {
    const { result, where, find } = await imported();
    expect(result.states.map((s) => s.id)).toEqual(['down', 'bracing', 'ember-sickness']);
    expect(find(result.states, 'down')).toMatchObject({
      knockout: true,
      restriction: 'cannotAct',
      priority: 100,
      icon: 1,
    });
    expect(find(result.states, 'bracing')).toMatchObject({
      knockout: false,
      removal: { battleEnd: true, turns: { min: 1, max: 1 } },
      modifiers: [{ type: 'damageTaken', value: 0.5 }],
    });
    expect(find(result.states, 'ember-sickness')).toMatchObject({
      restriction: 'confused',
      removal: { battleEnd: false, turns: { min: 3, max: 5 }, steps: 30, damageChance: 0.5 },
      // MZ's counterattack trait (ex-parameter 6) is FreeQuest's counterRate since 0.7.
      modifiers: [
        { type: 'counterRate', value: 0.2 },
        { type: 'hpRegen', value: -0.1 },
      ],
    });
    expect(where('Ember sickness').join('\n')).toMatch(/attack allies[\s\S]*after actions/);
    expect(where('Ember sickness').join('\n')).not.toMatch(/counterattack/);
    expect(where('Down')).toEqual(["Traits FreeQuest doesn't have: experience rate."]);
  });

  it('imports skills and items with their effects, attack and guard', async () => {
    const { result, where, find } = await imported();
    expect(result.attackSkill).toBe('strike');
    expect(result.guardSkill).toBe('brace');
    expect(find(result.skills, 'strike')).toMatchObject({
      occasion: 'battle',
      target: { side: 'enemy', select: 'one' },
      hitType: 'physical',
      effects: [
        {
          type: 'damage',
          pool: 'hp',
          element: 'attack',
          variance: 0.2,
          critical: true,
          formula: 'a.attack * 4 - b.defense * 2',
        },
      ],
    });
    expect(where('Strike')).toEqual([]);
    expect(find(result.skills, 'ember')).toMatchObject({
      description: 'A burst of flame.',
      skillType: 'spells',
      mpCost: 6,
      tpCost: 5,
      repeats: 2,
      target: { side: 'enemy', select: 'all' },
      effects: [
        {
          type: 'damage',
          element: 'fire',
          formula: 'floor(100 + a.magicAttack * 2 - b.magicDefense) + v["lanterns-lit"] * 3',
        },
        { type: 'addState', state: 'ember-sickness', chance: 0.25 },
        { type: 'buff', stat: 'attack', direction: 'up', turns: 3 },
      ],
    });
    // TP, the buff and the second hit all come across now (0.5).
    expect(where('Ember').join('\n')).not.toMatch(/TP|buffs|times/);
    expect(find(result.skills, 'mend')).toMatchObject({
      target: { side: 'ally', select: 'all' },
      effects: [{ type: 'recover', pool: 'hp', formula: 'a.attack * 4 - b.defense * 2' }],
    });
    expect(where('Mend').join('\n')).toMatch(
      /standing allies[\s\S]*`a\.isStateAffected\(3\) \? 500 : 50` couldn't be translated/,
    );

    expect(find(result.items, 'lamp-oil')).toMatchObject({
      price: 40,
      key: false,
      consumable: true,
      icon: 176,
      target: { side: 'ally', select: 'one' },
      effects: [
        { type: 'recover', pool: 'hp', formula: 'b.maxHp * 0.1 + 50' },
        { type: 'removeState', state: 'ember-sickness' },
      ],
    });
    expect(find(result.items, 'gate-key')).toMatchObject({
      key: true,
      consumable: false,
      occasion: 'never',
    });
    expect(find(result.items, 'gate-key')).not.toHaveProperty('icon');
    expect(where('Odd stone').join('\n')).toMatch(/hidden item/);
    expect(find(result.items, 'odd-stone').effects).toEqual([
      { type: 'commonEvent', common: 'open-gate' },
    ]);
  });

  it('imports weapons and armors as equipment', async () => {
    const { result, where, find } = await imported();
    expect(result.equipment.map((e) => e.id)).toEqual([
      'old-sword',
      'short-bow',
      'padded-coat',
      'buckler',
    ]);
    expect(find(result.equipment, 'old-sword')).toMatchObject({
      slot: 'weapon',
      equipmentType: 'sword',
      price: 100,
      modifiers: [
        { type: 'statFlat', stat: 'attack', value: 10 },
        { type: 'attackElement', element: 'physical' },
      ],
    });
    expect(find(result.equipment, 'padded-coat')).toMatchObject({
      slot: 'body',
      equipmentType: 'light-armor',
      modifiers: [
        { type: 'statFlat', stat: 'defense', value: 6 },
        { type: 'evasionRate', value: 0.05 },
      ],
    });
    // Armor type "Shield" meets weapon type "Shield" in one list.
    expect(find(result.equipment, 'buckler')).toMatchObject({
      slot: 'shield',
      equipmentType: 'shield-2',
      modifiers: [
        { type: 'statFlat', stat: 'defense', value: 4 },
        { type: 'damageTaken', value: 0.9 },
      ],
    });
    expect(where('Buckler').join()).toMatch(/Magical damage taken ×0\.8/);
    expect(where('Short bow')).toEqual(["Traits FreeQuest doesn't have: attack speed."]);
  });

  it('imports classes and actors, with curves, skills and starting equipment', async () => {
    const { result, where, find } = await imported();
    const lamplighter = find(result.classes, 'lamplighter');
    expect(lamplighter.stats.maxHp).toEqual({ 1: 100, 5: 140 });
    expect(lamplighter.stats.attack).toEqual({ 1: 10, 4: 15, 5: 20 });
    expect(lamplighter.exp).toEqual({ base: 30, exponent: 2 });
    // MZ's base chances (hit 95%…) are FreeQuest's own base, so nothing is left.
    expect(lamplighter.modifiers).toEqual([
      { type: 'equipType', equipmentType: 'sword' },
      { type: 'equipType', equipmentType: 'light-armor' },
    ]);
    expect(lamplighter.skills).toEqual([
      { level: 1, skill: 'brace' },
      { level: 3, skill: 'ember' },
    ]);
    expect(find(result.actors, 'wren')).toEqual({
      id: 'wren',
      name: 'Wren',
      description: 'Keeps the lamps lit.',
      class: 'lamplighter',
      character: 'hero',
      level: 2,
      maxLevel: 50,
      equipment: { weapon: 'old-sword', body: 'padded-coat' },
      modifiers: [],
    });
    expect(where('Wren').join()).toMatch(/starting “Buckler”/);
    expect(find(result.actors, 'tamsin')).toMatchObject({ class: 'lamplighter', equipment: {} });
    expect(where('Tamsin').join('\n')).toMatch(
      /class is missing[\s\S]*through the class[\s\S]*“Short bow”/,
    );
  });

  it('imports enemies and troops', async () => {
    const { result, where, find, report } = await imported();
    const moth = find(result.enemies, 'moth');
    expect(moth).toMatchObject({
      stats: {
        maxHp: 60,
        maxMp: 0,
        attack: 12,
        defense: 6,
        magicAttack: 4,
        magicDefense: 4,
        agility: 8,
        luck: 3,
      },
      exp: 12,
      gold: 7,
      drops: [
        { kind: 'item', id: 'lamp-oil', chance: 0.25 },
        { kind: 'equipment', id: 'old-sword', chance: 1 },
      ],
      actions: [
        { skill: 'strike', rating: 5, conditions: [] },
        { skill: 'ember', rating: 9, conditions: [{ type: 'hp', compare: 'below', percent: 51 }] },
        { skill: 'brace', rating: 4, conditions: [{ type: 'turn', from: 2, every: 3 }] },
        { skill: 'mend', rating: 3, conditions: [] },
      ],
      modifiers: [
        { type: 'elementRate', element: 'fire', value: 2 },
        { type: 'evasionRate', value: 0.05 },
      ],
    });
    expect(where('Moth').join()).toMatch(/a switch/);
    expect(find(result.enemies, 'shade')).toMatchObject({
      stats: { maxHp: 1 },
      actions: [{ skill: 'strike' }],
    });
    expect(result.troops).toEqual([
      // MZ's positions (the enemies' feet on its screen) are kept as places.
      {
        id: 'moth-2',
        name: 'Moth*2',
        enemies: ['moth', 'moth'],
        places: [
          { x: 300, y: 400 },
          { x: 500, y: 400 },
        ],
      },
      { id: 'shade', name: 'Shade', enemies: ['shade'], places: [{ x: 300, y: 400 }] },
    ]);
    expect(where('Moth*2').join('\n')).toMatch(/partway/);
    expect(where('Shade')).toEqual(['It had no usable actions; it attacks.']);
    expect(report.items.find((i) => i.where === 'Troops › Empty')?.level).toBe('note');
  });
});

describe('an imported project’s database', () => {
  it('opens with no problems, with the party and the type lists it uses', async () => {
    const target = new MemoryFs();
    await importMzProject(await memoryCopy(TINY), target, {
      template: await starter(),
      images: codec,
    });
    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    expect(project.manifest.data.start).toMatchObject({ party: ['wren', 'tamsin'], gold: 0 });
    // The variable the Ember formula reads is declared.
    expect(project.manifest.data.variables.map((v) => v.id)).toContain('lanterns-lit');
    const system = JSON.parse(await target.readText('data/database/system.json')) as Record<
      string,
      unknown
    >;
    expect(system).toMatchObject({ currency: 'Coins', attackSkill: 'strike', guardSkill: 'brace' });
    const actors = JSON.parse(await target.readText('data/database/actors.json')) as {
      entries: unknown[];
    };
    expect(actors.entries).toHaveLength(2);
    expect(target.files.has('data/maps/map001.json')).toBe(false);
  });
});
