import { Actor, type ActorData } from './actor.js';
import type { DatabaseIndex } from './database.js';

export const MAX_GOLD = 99_999_999;
export const MAX_ITEM_COUNT = 99;

/** Items and equipment are counted separately, so their ids may overlap. */
export type InventoryKind = 'item' | 'equipment';

/** Plain, serializable party state (what save files will store). */
export interface PartyData {
  /** Members in order. */
  members: ActorData[];
  gold: number;
  items: Record<string, number>;
  equipment: Record<string, number>;
}

/** The player's party: members, gold and inventory. */
export class Party {
  private readonly memberList: Actor[] = [];
  private currentGold = 0;
  private readonly bags: Record<InventoryKind, Map<string, number>> = {
    item: new Map(),
    equipment: new Map(),
  };

  constructor(private readonly db: DatabaseIndex) {}

  /** A new-game party from the manifest's starting party and gold. */
  static start(db: DatabaseIndex, start: { party: readonly string[]; gold: number }): Party {
    const party = new Party(db);
    for (const id of start.party) party.addMember(id);
    party.gainGold(start.gold);
    return party;
  }

  static fromData(db: DatabaseIndex, data: PartyData): Party {
    const party = new Party(db);
    party.memberList.push(...data.members.map((m) => Actor.fromData(db, m)));
    party.currentGold = data.gold;
    for (const [id, n] of Object.entries(data.items)) party.bags.item.set(id, n);
    for (const [id, n] of Object.entries(data.equipment)) party.bags.equipment.set(id, n);
    return party;
  }

  toData(): PartyData {
    return {
      members: this.memberList.map((m) => m.toData()),
      gold: this.currentGold,
      items: Object.fromEntries(this.bags.item),
      equipment: Object.fromEntries(this.bags.equipment),
    };
  }

  // Members ---------------------------------------------------------------

  get members(): readonly Actor[] {
    return this.memberList;
  }

  member(id: string): Actor | undefined {
    return this.memberList.find((m) => m.id === id);
  }

  hasMember(id: string): boolean {
    return this.member(id) !== undefined;
  }

  /** Add an actor at the end of the party. Does nothing if already a member. */
  addMember(id: string): void {
    if (!this.hasMember(id)) this.memberList.push(new Actor(this.db, id));
  }

  /** Remove an actor; their equipment goes with them (as in most RPGs). */
  removeMember(id: string): void {
    const index = this.memberList.findIndex((m) => m.id === id);
    if (index !== -1) this.memberList.splice(index, 1);
  }

  // Gold ------------------------------------------------------------------

  get gold(): number {
    return this.currentGold;
  }

  /** Change gold by `amount` (negative to spend), clamped to 0..MAX_GOLD. */
  gainGold(amount: number): void {
    this.currentGold = Math.min(Math.max(this.currentGold + Math.round(amount), 0), MAX_GOLD);
  }

  // Inventory -------------------------------------------------------------

  private lookup(kind: InventoryKind, id: string): void {
    if (kind === 'item') this.db.items.get(id);
    else this.db.equipment.get(id);
  }

  count(kind: InventoryKind, id: string): number {
    return this.bags[kind].get(id) ?? 0;
  }

  /** Change how many are carried by `amount` (negative to lose), clamped to 0..MAX_ITEM_COUNT. */
  gain(kind: InventoryKind, id: string, amount: number): void {
    this.lookup(kind, id);
    const next = Math.min(Math.max(this.count(kind, id) + Math.round(amount), 0), MAX_ITEM_COUNT);
    if (next === 0) this.bags[kind].delete(id);
    else this.bags[kind].set(id, next);
  }

  /** Carried (and, for equipment, optionally also worn by a member). */
  has(kind: InventoryKind, id: string, includeEquipped = false): boolean {
    if (this.count(kind, id) > 0) return true;
    return (
      kind === 'equipment' &&
      includeEquipped &&
      this.memberList.some((m) => [...m.equipment.values()].includes(id))
    );
  }

  /** Carried entries of a kind, in database order. */
  list(kind: InventoryKind): { id: string; count: number }[] {
    const order = kind === 'item' ? this.db.items.all : this.db.equipment.all;
    return order.flatMap((e) => {
      const count = this.count(kind, e.id);
      return count > 0 ? [{ id: e.id, count }] : [];
    });
  }

  // Equipment -------------------------------------------------------------

  /**
   * Equip a carried piece on a member (or empty a slot with null). The
   * previous piece returns to the inventory. Throws if not allowed.
   */
  equip(actorId: string, slot: string, equipmentId: string | null): void {
    const actor = this.member(actorId);
    if (!actor) throw new Error(`"${actorId}" is not in the party`);
    if (!this.db.system.equipmentSlots.some((s) => s.id === slot)) {
      throw new Error(`unknown equipment slot "${slot}"`);
    }
    if (equipmentId !== null && this.count('equipment', equipmentId) < 1) {
      throw new Error(`no "${equipmentId}" in the inventory`);
    }
    const previous = actor.setEquipment(slot, equipmentId);
    if (equipmentId !== null) this.gain('equipment', equipmentId, -1);
    if (previous !== null) this.gain('equipment', previous, 1);
  }

  /** Carried equipment a member could put in a slot. */
  equippableFor(actorId: string, slot: string): string[] {
    const actor = this.member(actorId);
    if (!actor) return [];
    return this.list('equipment')
      .map((e) => e.id)
      .filter((id) => this.db.equipment.get(id).slot === slot && actor.canEquip(id));
  }
}
