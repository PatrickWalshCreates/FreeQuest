import { type Action, ActionState, World } from '@freequest/core';
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ShopController } from '../src/shop-controller.js';
import { demoDb, readDemo } from './demo.js';

const db = demoDb();
const manifest = parseProjectFile('manifest', readDemo('project.json'));

function setup(gold: number, canSell = true) {
  const world = new World({
    manifest,
    map: parseProjectFile('map', readDemo('data/maps/map001.json')),
    tileset: parseProjectFile('tileset', readDemo('data/tilesets/overworld.json')),
    database: db,
  });
  world.party.gainGold(gold - world.party.gold);
  const shop = new ShopController(
    world,
    [
      { kind: 'item', id: 'potion' },
      { kind: 'item', id: 'ether', price: 120 },
      { kind: 'equipment', id: 'bronze-sword' },
    ],
    canSell,
  );
  const input = new ActionState();
  const tap = (action: Action, times = 1) => {
    for (let i = 0; i < times; i++) {
      input.press(action);
      shop.update(input);
      input.endStep();
      input.release(action);
    }
  };
  return { world, shop, tap };
}

describe('ShopController', () => {
  it('offers buy, sell and leave, and leaves with cancel', () => {
    const { shop, tap } = setup(100);
    expect(shop.state.options.map((o) => o.label)).toEqual(['Buy', 'Sell', 'Leave']);
    expect(setup(100, false).shop.state.options.map((o) => o.label)).toEqual(['Buy', 'Leave']);
    tap('cancel');
    expect(shop.isClosed).toBe(true);
  });

  it("lists goods at their prices and greys out what the party can't afford", () => {
    const { shop, tap } = setup(100);
    tap('confirm');
    expect(shop.state.screen).toBe('buy');
    expect(shop.state.options).toEqual([
      { label: 'Potion', detail: '50', enabled: true },
      { label: 'Ether', detail: '120', enabled: false },
      { label: 'Bronze Sword', detail: '100', enabled: true },
    ]);
    tap('down', 2);
    expect(shop.state.info).toEqual(
      expect.arrayContaining([expect.stringMatching(/^Can equip: /)]),
    );
  });

  it('buys a chosen number, within what the party can afford', () => {
    const { world, shop, tap } = setup(170);
    tap('confirm'); // Buy
    tap('confirm'); // Potion
    expect(shop.state.quantity).toMatchObject({ name: 'Potion', count: 1, max: 3, total: 50 });
    tap('right'); // +10, capped at 3
    expect(shop.state.quantity?.count).toBe(3);
    tap('up'); // wraps to 1
    expect(shop.state.quantity?.count).toBe(1);
    tap('down'); // wraps to the max
    tap('confirm');
    expect(world.party.gold).toBe(20);
    expect(world.party.count('item', 'potion')).toBe(3);
    expect(shop.state).toMatchObject({ screen: 'buy', message: 'Bought 3 × Potion.' });
    tap('down');
    expect(shop.state.message).toBeNull();
  });

  it('sells carried things at half price, never key items', () => {
    const { world, shop, tap } = setup(0);
    world.party.gain('item', 'ether', 2);
    world.party.gain('item', 'meadow-map', 1);
    tap('down');
    tap('confirm'); // Sell
    const labels = shop.state.options.map((o) => [o.label, o.detail, o.enabled]);
    expect(labels).toContainEqual(['Ether ×2', '75', true]);
    expect(labels).toContainEqual(["Elder's Map ×1", '—', false]);
    const ether = shop.state.options.findIndex((o) => o.label.startsWith('Ether'));
    tap('down', ether);
    tap('confirm');
    tap('up'); // 2
    tap('confirm');
    expect(world.party.gold).toBe(150);
    expect(world.party.count('item', 'ether')).toBe(0);
    expect(shop.state.message).toBe('Sold 2 × Ether.');
    tap('cancel');
    tap('cancel');
    expect(shop.isClosed).toBe(true);
  });
});
