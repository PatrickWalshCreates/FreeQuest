import { describe, expect, it } from 'vitest';
import {
  Interpreter,
  GameState,
  MAX_GOLD,
  MAX_ITEM_COUNT,
  Party,
  buy,
  buyPrice,
  maxBuy,
  maxSell,
  sell,
  sellPrice,
} from '../src/index.js';
import { demoDb } from './demo-db.js';
import { makeManifest } from './fixtures.js';

const db = demoDb();
const party = (gold: number) => Party.start(db, { party: ['hero'], gold });

describe('shop prices', () => {
  it('uses the shop price, else the entry price; sells at half, key items never', () => {
    expect(buyPrice(db, { kind: 'item', id: 'potion' })).toBe(50);
    expect(buyPrice(db, { kind: 'item', id: 'potion', price: 35 })).toBe(35);
    expect(buyPrice(db, { kind: 'equipment', id: 'bronze-sword' })).toBe(100);
    expect(sellPrice(db, 'item', 'ether')).toBe(75);
    expect(sellPrice(db, 'equipment', 'straw-hat')).toBe(15);
    expect(sellPrice(db, 'item', 'meadow-map')).toBe(0);
  });

  it('limits purchases by gold and bag space', () => {
    const p = party(120);
    expect(maxBuy(p, db, { kind: 'item', id: 'potion' })).toBe(2);
    p.gain('item', 'antidote', MAX_ITEM_COUNT - 1);
    expect(maxBuy(p, db, { kind: 'item', id: 'antidote' })).toBe(1);
    expect(maxBuy(p, db, { kind: 'item', id: 'potion', price: 0 })).toBe(MAX_ITEM_COUNT);
  });

  it('limits sales by what is carried and the gold cap', () => {
    const p = party(0);
    p.gain('item', 'ether', 3);
    expect(maxSell(p, db, 'item', 'ether')).toBe(3);
    p.gain('item', 'meadow-map', 1);
    expect(maxSell(p, db, 'item', 'meadow-map')).toBe(0);
    p.gainGold(MAX_GOLD - 100);
    expect(maxSell(p, db, 'item', 'ether')).toBe(1);
  });
});

describe('buying and selling', () => {
  it('moves gold and goods both ways', () => {
    const p = party(200);
    buy(p, db, { kind: 'item', id: 'potion' }, 3);
    expect(p.gold).toBe(50);
    expect(p.count('item', 'potion')).toBe(3);
    sell(p, db, 'item', 'potion', 2);
    expect(p.gold).toBe(100);
    expect(p.count('item', 'potion')).toBe(1);
  });

  it("refuses what the party can't afford, carry or sell", () => {
    const p = party(40);
    expect(() => buy(p, db, { kind: 'item', id: 'potion' }, 1)).toThrow();
    expect(() => buy(p, db, { kind: 'item', id: 'potion' }, 0)).toThrow();
    expect(() => sell(p, db, 'item', 'ether', 1)).toThrow();
    expect(p.gold).toBe(40);
  });
});

describe('shop command', () => {
  it('asks the runtime to open the shop and continues once it closes', () => {
    const state = new GameState(makeManifest());
    const interpreter = new Interpreter(
      [
        { type: 'shop', goods: [{ kind: 'item', id: 'potion' }], canSell: true },
        { type: 'message', text: 'Come again!' },
      ],
      state,
    );
    interpreter.update(0);
    expect(interpreter.pending).toEqual({
      type: 'shop',
      goods: [{ kind: 'item', id: 'potion' }],
      canSell: true,
    });
    interpreter.continue();
    interpreter.update(0);
    expect(interpreter.pending).toMatchObject({ type: 'message', text: 'Come again!' });
  });
});
