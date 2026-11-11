// The shop screen: buy the shop's goods, sell what the party carries, pick
// how many. Free of PixiJS so it can be tested in Node; `shop-view.ts`
// draws the state. Prices and limits come from core (`shop.ts`).
import {
  type InputState,
  type InventoryKind,
  type World,
  buy,
  buyPrice,
  maxBuy,
  maxSell,
  sell,
  sellPrice,
} from '@freequest/core';
import type { ShopGood } from '@freequest/schema';
import type { MenuOption } from './battle-controller.js';
import { withIcon } from './icons.js';

export type ShopScreen = 'root' | 'buy' | 'sell' | 'quantity';

/** The count being chosen before buying or selling. */
export interface ShopQuantity {
  readonly mode: 'buy' | 'sell';
  readonly name: string;
  readonly count: number;
  readonly max: number;
  /** Price of one. */
  readonly price: number;
  /** count × price. */
  readonly total: number;
}

/** Everything the view needs to draw one frame. */
export interface ShopUiState {
  readonly screen: ShopScreen;
  readonly title: string;
  readonly options: readonly MenuOption[];
  readonly cursor: number;
  /** About the highlighted good: description, how many are carried, who can equip it. */
  readonly info: readonly string[];
  readonly gold: number;
  readonly currency: string;
  readonly quantity: ShopQuantity | null;
  /** Feedback such as "Bought 3 × Potion." Cleared by the next key press. */
  readonly message: string | null;
}

interface Thing {
  readonly kind: InventoryKind;
  readonly id: string;
}

const ROOT_BUY = 'Buy';
const ROOT_SELL = 'Sell';
const ROOT_LEAVE = 'Leave';

export class ShopController {
  private screen: ShopScreen = 'root';
  private readonly cursors: Record<'root' | 'buy' | 'sell', number> = { root: 0, buy: 0, sell: 0 };
  private count = 1;
  private feedback: string | null = null;
  private closed = false;
  /** What the quantity screen is about, and whether it's a purchase. */
  private picked: { mode: 'buy'; good: ShopGood } | { mode: 'sell'; thing: Thing } | null = null;

  constructor(
    private readonly world: World,
    readonly goods: readonly ShopGood[],
    readonly canSell: boolean,
  ) {}

  /** True once the player has left; the game then answers the shop request. */
  get isClosed(): boolean {
    return this.closed;
  }

  private get db() {
    return this.world.db;
  }

  private get party() {
    return this.world.party;
  }

  private nameOf(kind: InventoryKind, id: string): string {
    return kind === 'item' ? this.db.items.get(id).name : this.db.equipment.get(id).name;
  }

  private iconOf(kind: InventoryKind, id: string): number | undefined {
    return kind === 'item' ? this.db.items.get(id).icon : this.db.equipment.get(id).icon;
  }

  private rootOptions(): MenuOption[] {
    return [
      { label: ROOT_BUY, enabled: true },
      ...(this.canSell ? [{ label: ROOT_SELL, enabled: true }] : []),
      { label: ROOT_LEAVE, enabled: true },
    ];
  }

  /** Everything the party carries, items first, in database order. */
  private sellables(): Thing[] {
    return [
      ...this.party.list('item').map(({ id }) => ({ kind: 'item' as const, id })),
      ...this.party.list('equipment').map(({ id }) => ({ kind: 'equipment' as const, id })),
    ];
  }

  private options(screen: ShopScreen): MenuOption[] {
    switch (screen) {
      case 'root':
        return this.rootOptions();
      case 'buy':
        return this.goods.map((good) => ({
          label: this.nameOf(good.kind, good.id),
          ...withIcon(this.iconOf(good.kind, good.id)),
          detail: String(buyPrice(this.db, good)),
          enabled: maxBuy(this.party, this.db, good) > 0,
        }));
      case 'sell':
        return this.sellables().map(({ kind, id }) => {
          const price = sellPrice(this.db, kind, id);
          return {
            label: `${this.nameOf(kind, id)} ×${this.party.count(kind, id)}`,
            ...withIcon(this.iconOf(kind, id)),
            detail: price > 0 ? String(price) : '—',
            enabled: maxSell(this.party, this.db, kind, id) > 0,
          };
        });
      case 'quantity':
        return [];
    }
  }

  /** The good the cursor is on (or the quantity screen is about). */
  private current(): Thing | null {
    if (this.screen === 'quantity' && this.picked) {
      return this.picked.mode === 'buy' ? this.picked.good : this.picked.thing;
    }
    if (this.screen === 'buy') return this.goods[this.cursors.buy] ?? null;
    if (this.screen === 'sell') return this.sellables()[this.cursors.sell] ?? null;
    return null;
  }

  private info(thing: Thing | null): string[] {
    if (!thing) return [];
    const lines: string[] = [];
    const entry =
      thing.kind === 'item' ? this.db.items.get(thing.id) : this.db.equipment.get(thing.id);
    if (entry.description) lines.push(entry.description);
    const carried = this.party.count(thing.kind, thing.id);
    if (thing.kind === 'equipment') {
      const worn = this.party.members.filter((m) => [...m.equipment.values()].includes(thing.id));
      lines.push(
        `Carried: ${carried}${worn.length > 0 ? ` (worn by ${worn.map((m) => m.name).join(', ')})` : ''}`,
      );
      const users = this.party.members.filter((m) => m.canEquip(thing.id)).map((m) => m.name);
      lines.push(
        users.length > 0 ? `Can equip: ${users.join(', ')}` : 'Nobody in the party can equip it',
      );
    } else {
      lines.push(`Carried: ${carried}`);
      if (this.db.items.get(thing.id).key) lines.push('A key item: it can’t be sold.');
    }
    return lines;
  }

  private quantity(): ShopQuantity | null {
    const picked = this.picked;
    if (this.screen !== 'quantity' || !picked) return null;
    const { kind, id } = picked.mode === 'buy' ? picked.good : picked.thing;
    const price =
      picked.mode === 'buy' ? buyPrice(this.db, picked.good) : sellPrice(this.db, kind, id);
    return {
      mode: picked.mode,
      name: this.nameOf(kind, id),
      count: this.count,
      max: this.maxCount(),
      price,
      total: price * this.count,
    };
  }

  private maxCount(): number {
    const picked = this.picked;
    if (!picked) return 0;
    return picked.mode === 'buy'
      ? maxBuy(this.party, this.db, picked.good)
      : maxSell(this.party, this.db, picked.thing.kind, picked.thing.id);
  }

  get state(): ShopUiState {
    const list = this.screen === 'quantity' ? (this.picked?.mode ?? 'buy') : this.screen;
    return {
      screen: this.screen,
      title: this.screen === 'root' ? 'Shop' : list === 'buy' ? 'Buy' : 'Sell',
      options: this.options(list),
      cursor: this.cursors[list],
      info: this.info(this.current()),
      gold: this.party.gold,
      currency: this.db.system.currency,
      quantity: this.quantity(),
      message: this.feedback,
    };
  }

  update(input: InputState): void {
    if (this.closed) return;
    const pressed = (['confirm', 'cancel', 'up', 'down', 'left', 'right'] as const).some((a) =>
      input.justPressed(a),
    );
    if (pressed) this.feedback = null;
    if (this.screen === 'quantity') {
      this.updateQuantity(input);
      return;
    }
    const screen = this.screen;
    const options = this.options(screen);
    const count = options.length;
    if (count > 0 && input.justPressed('down'))
      this.cursors[screen] = (this.cursors[screen] + 1) % count;
    if (count > 0 && input.justPressed('up')) {
      this.cursors[screen] = (this.cursors[screen] - 1 + count) % count;
    }
    if (input.justPressed('cancel')) {
      if (screen === 'root') this.closed = true;
      else this.screen = 'root';
      return;
    }
    if (!input.justPressed('confirm')) return;
    const option = options[this.cursors[screen]];
    if (!option?.enabled) return;
    if (screen === 'root') {
      if (option.label === ROOT_BUY) this.screen = 'buy';
      else if (option.label === ROOT_SELL) this.screen = 'sell';
      else this.closed = true;
      return;
    }
    if (screen === 'buy') {
      const good = this.goods[this.cursors.buy];
      if (!good) return;
      this.picked = { mode: 'buy', good };
    } else {
      const thing = this.sellables()[this.cursors.sell];
      if (!thing) return;
      this.picked = { mode: 'sell', thing };
    }
    this.count = 1;
    this.screen = 'quantity';
  }

  private updateQuantity(input: InputState): void {
    const picked = this.picked;
    const max = this.maxCount();
    const back = () => {
      this.screen = picked?.mode ?? 'root';
      this.picked = null;
    };
    if (!picked || max === 0) {
      back();
      return;
    }
    const step = (by: number, wrap: boolean) => {
      const next = this.count + by;
      if (wrap) this.count = next > max ? 1 : next < 1 ? max : next;
      else this.count = Math.min(max, Math.max(1, next));
    };
    if (input.justPressed('up')) step(1, true);
    if (input.justPressed('down')) step(-1, true);
    if (input.justPressed('right')) step(10, false);
    if (input.justPressed('left')) step(-10, false);
    if (input.justPressed('cancel')) {
      back();
      return;
    }
    if (!input.justPressed('confirm')) return;
    const { kind, id } = picked.mode === 'buy' ? picked.good : picked.thing;
    const name = this.nameOf(kind, id);
    if (picked.mode === 'buy') {
      buy(this.party, this.db, picked.good, this.count);
      this.feedback = `Bought ${this.count} × ${name}.`;
    } else {
      sell(this.party, this.db, kind, id, this.count);
      this.feedback = `Sold ${this.count} × ${name}.`;
      // The sold-out row is gone: keep the cursor on the list.
      const left = this.sellables().length;
      this.cursors.sell = Math.min(this.cursors.sell, Math.max(0, left - 1));
    }
    back();
  }
}
