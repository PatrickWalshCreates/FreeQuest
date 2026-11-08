import { describe, expect, it } from 'vitest';
import { MAX_GOLD, MAX_ITEM_COUNT, Party } from '../src/index.js';
import { demoDb } from './demo-db.js';

const db = demoDb();
const start = () => Party.start(db, { party: ['hero'], gold: 50 });

describe('Party members', () => {
  it('starts from the manifest party and gold', () => {
    const party = start();
    expect(party.members.map((m) => m.id)).toEqual(['hero']);
    expect(party.gold).toBe(50);
  });

  it('adds members once, in order, and removes them', () => {
    const party = start();
    party.addMember('mira');
    party.addMember('mira');
    expect(party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
    party.removeMember('hero');
    expect(party.members.map((m) => m.id)).toEqual(['mira']);
    expect(() => party.addMember('ghost')).toThrow(/unknown actor/);
  });
});

describe('Party gold and inventory', () => {
  it('clamps gold to 0..MAX_GOLD', () => {
    const party = start();
    party.gainGold(-1000);
    expect(party.gold).toBe(0);
    party.gainGold(MAX_GOLD * 2);
    expect(party.gold).toBe(MAX_GOLD);
  });

  it('counts items and equipment separately, clamped to 0..99', () => {
    const party = start();
    party.gain('item', 'potion', 3);
    party.gain('item', 'potion', -1);
    expect(party.count('item', 'potion')).toBe(2);
    party.gain('item', 'potion', 500);
    expect(party.count('item', 'potion')).toBe(MAX_ITEM_COUNT);
    party.gain('item', 'potion', -500);
    expect(party.has('item', 'potion')).toBe(false);
    expect(party.toData().items).toEqual({}); // no zero entries kept
  });

  it('rejects unknown ids for the right kind', () => {
    const party = start();
    expect(() => party.gain('item', 'bronze-sword', 1)).toThrow(/unknown item/);
    expect(() => party.gain('equipment', 'potion', 1)).toThrow(/unknown equipment/);
  });

  it('lists carried entries in database order', () => {
    const party = start();
    party.gain('item', 'antidote', 1);
    party.gain('item', 'potion', 2);
    expect(party.list('item')).toEqual([
      { id: 'potion', count: 2 },
      { id: 'antidote', count: 1 },
    ]);
  });

  it('can count worn equipment as owned', () => {
    const party = start();
    expect(party.has('equipment', 'bronze-sword')).toBe(false);
    expect(party.has('equipment', 'bronze-sword', true)).toBe(true);
  });
});

describe('Party equipment', () => {
  it('swaps equipment between the bag and a member', () => {
    const party = start();
    party.addMember('mira');
    party.gain('equipment', 'wooden-shield', 1);
    party.equip('hero', 'shield', 'wooden-shield');
    const hero = party.member('hero');
    expect(hero?.equipment.get('shield')).toBe('wooden-shield');
    expect(hero?.stat('defense')).toBe(12 + 8 + 6);
    expect(party.count('equipment', 'wooden-shield')).toBe(0);

    party.equip('hero', 'shield', null);
    expect(hero?.equipment.has('shield')).toBe(false);
    expect(party.count('equipment', 'wooden-shield')).toBe(1);
  });

  it('returns the replaced piece to the bag', () => {
    const party = start();
    party.gain('equipment', 'bronze-sword', 1);
    party.equip('hero', 'weapon', 'bronze-sword');
    expect(party.count('equipment', 'bronze-sword')).toBe(1); // old one came back
  });

  it('enforces slot, type, membership and inventory rules without side effects', () => {
    const party = start();
    party.addMember('mira');
    party.gain('equipment', 'wooden-shield', 1);
    party.gain('equipment', 'oak-staff', 1);
    expect(() => party.equip('mira', 'shield', 'wooden-shield')).toThrow(/cannot equip/);
    expect(() => party.equip('hero', 'weapon', 'oak-staff')).toThrow(/cannot equip/);
    expect(() => party.equip('hero', 'head', 'wooden-shield')).toThrow(/goes in slot "shield"/);
    expect(() => party.equip('hero', 'cape', null)).toThrow(/unknown equipment slot/);
    expect(() => party.equip('hero', 'head', 'straw-hat')).toThrow(/no "straw-hat"/);
    expect(() => party.equip('ghost', 'head', null)).toThrow(/not in the party/);
    expect(party.count('equipment', 'wooden-shield')).toBe(1);
    expect(party.count('equipment', 'oak-staff')).toBe(1);
  });

  it('lists what a member could wear in a slot', () => {
    const party = start();
    party.addMember('mira');
    for (const id of ['wooden-shield', 'oak-staff', 'bronze-sword', 'straw-hat']) {
      party.gain('equipment', id, 1);
    }
    expect(party.equippableFor('hero', 'weapon')).toEqual(['bronze-sword']);
    expect(party.equippableFor('mira', 'weapon')).toEqual(['oak-staff']);
    expect(party.equippableFor('mira', 'head')).toEqual(['straw-hat']);
  });

  it('clamps HP when equipment lowers max HP', () => {
    const party = start();
    const hero = party.member('hero');
    if (!hero) throw new Error('fixture');
    expect(hero.hp).toBe(hero.maxHp);
    party.equip('hero', 'body', null);
    expect(hero.hp).toBeLessThanOrEqual(hero.maxHp);
  });
});

describe('Party data', () => {
  it('round-trips through plain JSON', () => {
    const party = start();
    party.addMember('mira');
    party.gainGold(123);
    party.gain('item', 'potion', 4);
    party.gain('equipment', 'straw-hat', 2);
    party.equip('mira', 'head', 'straw-hat');
    party.member('mira')?.gainExp(200);
    const data = JSON.parse(JSON.stringify(party.toData())) as ReturnType<Party['toData']>;
    const copy = Party.fromData(db, data);
    expect(copy.toData()).toEqual(party.toData());
    expect(copy.member('mira')?.stat('defense')).toBe(party.member('mira')?.stat('defense'));
  });
});
