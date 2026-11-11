// Buying and selling: prices and limits, applied to the party. The runtime's
// shop screen only shows these numbers and calls buy/sell.
import type { ShopGood } from '@freequest/schema';
import type { DatabaseIndex } from './database.js';
import { MAX_GOLD, MAX_ITEM_COUNT, type InventoryKind, type Party } from './party.js';

/** What a good costs here: the shop's own price, else the entry's. */
export function buyPrice(db: DatabaseIndex, good: ShopGood): number {
  if (good.price !== undefined) return good.price;
  return good.kind === 'item' ? db.items.get(good.id).price : db.equipment.get(good.id).price;
}

/** What the shop pays for one: half the entry's price, rounded down (0 = it won't buy it). */
export function sellPrice(db: DatabaseIndex, kind: InventoryKind, id: string): number {
  if (kind === 'item') {
    const item = db.items.get(id);
    return item.key ? 0 : Math.floor(item.price / 2);
  }
  return Math.floor(db.equipment.get(id).price / 2);
}

/** The most of a good the party can buy now: gold and bag space both limit it. */
export function maxBuy(party: Party, db: DatabaseIndex, good: ShopGood): number {
  const room = MAX_ITEM_COUNT - party.count(good.kind, good.id);
  const price = buyPrice(db, good);
  const affordable = price === 0 ? room : Math.floor(party.gold / price);
  return Math.max(0, Math.min(room, affordable));
}

/** The most the party can sell of something it carries (0 if the shop won't take it). */
export function maxSell(party: Party, db: DatabaseIndex, kind: InventoryKind, id: string): number {
  const price = sellPrice(db, kind, id);
  if (price === 0) return 0;
  // Never more than would push gold past its cap.
  return Math.min(party.count(kind, id), Math.floor((MAX_GOLD - party.gold) / price));
}

/** Buy `count` of a good. Throws if the party can't (the screen never offers it). */
export function buy(party: Party, db: DatabaseIndex, good: ShopGood, count: number): void {
  if (!Number.isInteger(count) || count < 1) throw new Error(`can't buy ${count}`);
  if (count > maxBuy(party, db, good)) throw new Error(`can't buy ${count} × ${good.id}`);
  party.gainGold(-buyPrice(db, good) * count);
  party.gain(good.kind, good.id, count);
}

/** Sell `count` of something the party carries. Throws if it can't. */
export function sell(
  party: Party,
  db: DatabaseIndex,
  kind: InventoryKind,
  id: string,
  count: number,
): void {
  if (!Number.isInteger(count) || count < 1) throw new Error(`can't sell ${count}`);
  if (count > maxSell(party, db, kind, id)) throw new Error(`can't sell ${count} × ${id}`);
  party.gain(kind, id, -count);
  party.gainGold(sellPrice(db, kind, id) * count);
}
