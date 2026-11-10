import { type Action, ActionState, World } from '@freequest/core';
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { MenuController, formatPlayTime } from '../src/menu-controller.js';
import { MemoryStorage, SaveStore } from '../src/save-store.js';
import { demoDb, readDemo } from './demo.js';

const db = demoDb();
const manifest = parseProjectFile('manifest', readDemo('project.json'));

function setup() {
  const world = new World({
    manifest,
    map: parseProjectFile('map', readDemo('data/maps/map001.json')),
    tileset: parseProjectFile('tileset', readDemo('data/tilesets/overworld.json')),
    database: db,
  });
  const saves = new SaveStore(new MemoryStorage(), manifest);
  const menu = new MenuController({
    world,
    saves,
    game: manifest.id,
    playSeconds: () => 3725,
    random: () => 0.5,
  });
  const input = new ActionState();
  const tap = (action: Action, times = 1) => {
    for (let i = 0; i < times; i++) {
      input.press(action);
      menu.update(input);
      input.endStep();
      input.release(action);
    }
  };
  const hero = world.party.member('hero');
  if (!hero) throw new Error('fixture');
  return { world, saves, menu, tap, hero };
}

describe('MenuController', () => {
  it('opens on the root commands and closes with cancel', () => {
    const { menu, tap } = setup();
    expect(menu.state.options.map((o) => o.label)).toEqual([
      'Items',
      'Skills',
      'Equipment',
      'Status',
      'Save',
      'Quit',
    ]);
    expect(menu.state.options[1]?.enabled).toBe(false); // the hero alone knows no menu skills
    tap('cancel');
    expect(menu.outcome).toBe('closed');
  });

  it('uses a potion on a chosen member and reports the result', () => {
    const { world, menu, tap, hero } = setup();
    world.party.gain('item', 'potion', 2);
    world.party.gain('item', 'meadow-map', 1);
    hero.setHp(10);
    tap('confirm'); // Items
    expect(menu.state.options).toEqual([
      { label: 'Potion', detail: '×2', enabled: true },
      { label: "Elder's Map", detail: '×1', enabled: false }, // key item, never usable
    ]);
    tap('confirm'); // Potion
    expect(menu.state).toMatchObject({ screen: 'target', title: 'Use Potion on' });
    tap('confirm'); // Hero
    expect(hero.hp).toBe(110);
    expect(menu.state.message).toBe('Hero recovers 100 HP.');
    expect(menu.state.screen).toBe('target'); // one potion left: stay
    tap('confirm');
    expect(world.party.count('item', 'potion')).toBe(0);
    expect(menu.state.screen).toBe('items'); // out of potions: back to the list
    tap('down');
    expect(menu.state.message).toBeNull(); // any key clears the message
  });

  it('casts Heal from the menu, paying MP', () => {
    const { world, menu, tap, hero } = setup();
    world.party.addMember('mira');
    const mira = world.party.member('mira');
    if (!mira) throw new Error('fixture');
    hero.setHp(5);
    tap('down'); // Skills
    tap('confirm');
    expect(menu.state.options.map((o) => [o.label, o.enabled])).toEqual([
      ['Hero', false],
      ['Mira', true],
    ]);
    tap('down');
    tap('confirm'); // Mira
    expect(menu.state.options.map((o) => o.label)).toEqual(['Heal']); // Fire is battle-only
    const mp = mira.mp;
    tap('confirm'); // Heal → target list
    tap('confirm'); // Hero
    expect(hero.hp).toBe(hero.maxHp);
    expect(mira.mp).toBe(mp - 4);
  });

  it('equips and removes gear through the bag', () => {
    const { world, menu, tap, hero } = setup();
    world.party.gain('equipment', 'wooden-shield', 1);
    tap('down', 2); // Equipment
    tap('confirm'); // who? → Hero
    tap('confirm');
    expect(menu.state.options.map((o) => [o.label, o.detail])).toEqual([
      ['Weapon', 'Bronze Sword'],
      ['Shield', '—'],
      ['Head', '—'],
      ['Body', 'Leather Vest'],
      ['Accessory', '—'],
    ]);
    tap('down');
    tap('confirm'); // Shield
    expect(menu.state.options.map((o) => [o.label, o.enabled])).toEqual([
      ['Wooden Shield', true],
      ['(Remove)', false],
    ]);
    tap('confirm');
    expect(hero.equipment.get('shield')).toBe('wooden-shield');
    expect(menu.state.screen).toBe('equipSlots');
    tap('confirm'); // Shield again
    tap('down');
    tap('confirm'); // (Remove)
    expect(hero.equipment.has('shield')).toBe(false);
    expect(world.party.count('equipment', 'wooden-shield')).toBe(1);
  });

  it('shows a status page for a member', () => {
    const { menu, tap, hero } = setup();
    tap('down', 3);
    tap('confirm'); // Status
    tap('confirm'); // Hero
    expect(menu.state).toMatchObject({ screen: 'status', actor: hero, title: 'Hero' });
    tap('cancel');
    tap('cancel');
    expect(menu.state.screen).toBe('root');
  });

  it('saves to a slot and shows it in the slot list', () => {
    const { saves, menu, tap } = setup();
    tap('down', 4);
    tap('confirm'); // Save
    expect(menu.state.options.map((o) => o.detail)).toEqual(['Empty', 'Empty', 'Empty']);
    tap('down');
    tap('confirm'); // slot 2
    expect(menu.state.message).toBe('Saved to slot 2.');
    expect(menu.state.options[1]).toEqual({
      label: 'Slot 2: Meadow',
      // The menu's list is narrow (the party is shown beside it): place and play time only.
      detail: '1:02:05',
      enabled: true,
    });
    const slot = saves.read(2);
    expect(slot.kind === 'save' && slot.save.playSeconds).toBe(3725);
  });

  it('reports a failed save instead of throwing', () => {
    const { world } = setup();
    const full = new SaveStore(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('quota exceeded');
        },
        removeItem: () => undefined,
      },
      manifest,
    );
    const failing = new MenuController({
      world,
      saves: full,
      game: manifest.id,
      playSeconds: () => 0,
    });
    const input = new ActionState();
    for (const a of ['down', 'down', 'down', 'down', 'confirm', 'confirm'] as const) {
      input.press(a);
      failing.update(input);
      input.endStep();
      input.release(a);
    }
    expect(failing.state.message).toBe("Couldn't save: quota exceeded");
  });

  it('asks before quitting to the title', () => {
    const { menu, tap } = setup();
    tap('up'); // wrap to Quit
    tap('confirm');
    expect(menu.state.options.map((o) => o.label)).toEqual(['Yes', 'No']);
    tap('down');
    tap('confirm'); // No
    expect(menu.state.screen).toBe('root');
    expect(menu.outcome).toBeNull();
    tap('confirm');
    tap('confirm'); // Yes
    expect(menu.outcome).toBe('quit');
  });
});

describe('formatPlayTime', () => {
  it('formats hours:minutes:seconds', () => {
    expect(formatPlayTime(0)).toBe('0:00:00');
    expect(formatPlayTime(3725.9)).toBe('1:02:05');
  });
});
