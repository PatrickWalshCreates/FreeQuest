import { type SaveFile, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawHouse from '../../../samples/demo-project/data/maps/house.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { World } from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const meadow = parseProjectFile('map', rawMap);
const house = parseProjectFile('map', rawHouse);
const tileset = parseProjectFile('tileset', rawTileset);
const db = demoDb();

function progressedWorld(): World {
  const world = new World({ manifest, map: meadow, tileset, database: db, random: () => 0.5 });
  world.state.setSwitch('accepted_request', true);
  world.state.setVariable('bridge_visits', 2);
  world.party.addMember('mira');
  world.party.gainGold(123);
  world.party.gain('item', 'potion', 3);
  world.party.gain('equipment', 'straw-hat', 1);
  world.party.equip('mira', 'head', 'straw-hat');
  world.party.member('hero')?.gainExp(300);
  world.party.member('hero')?.setHp(17);
  world.party.member('mira')?.addState('poison');
  world.changeMap(house, tileset, 3, 4, 'left');
  return world;
}

/** Save → JSON text → parse/validate, as a save slot would. */
const roundTrip = (save: SaveFile): SaveFile =>
  parseProjectFile('save', JSON.parse(JSON.stringify(save)), 'slot');

describe('saving and loading', () => {
  it('produces a valid save file with a slot summary', () => {
    const world = progressedWorld();
    const save = world.toSave({ game: manifest.id, playSeconds: 754, savedAt: new Date(0) });
    expect(roundTrip(save)).toEqual(save);
    expect(save).toMatchObject({
      game: 'freequest-demo',
      savedAt: '1970-01-01T00:00:00.000Z',
      playSeconds: 754,
      map: 'house',
      x: 3,
      y: 4,
      direction: 'left',
      switches: { accepted_request: true },
      variables: { bridge_visits: 2 },
      summary: {
        location: "Elder's house",
        members: [{ name: 'Hero' }, { name: 'Mira', level: 3 }],
      },
    });
  });

  it('restores the same game', () => {
    const world = progressedWorld();
    const save = roundTrip(world.toSave({ game: manifest.id, playSeconds: 10 }));
    const restored = World.fromSave(save, { manifest, map: house, tileset, database: db });
    expect(
      restored.toSave({ game: manifest.id, playSeconds: 10, savedAt: new Date(save.savedAt) }),
    ).toEqual(save);
    expect([restored.player.x, restored.player.y, restored.player.direction]).toEqual([
      3,
      4,
      'left',
    ]);
    expect(restored.map.id).toBe('house');
    expect(restored.party.member('hero')?.stats()).toEqual(world.party.member('hero')?.stats());
    expect(restored.party.member('mira')?.equipment.get('head')).toBe('straw-hat');
    expect(restored.party.member('mira')?.hasState('poison')).toBe(true);
    // Event pages reflect the restored switches straight away.
    // The request is accepted, so the hearth shows its lit page.
    expect(restored.events.find((e) => e.id === 'hearth')?.pageIndex).toBe(1);
  });

  it('drops switches and variables the project no longer declares', () => {
    const world = progressedWorld();
    const save = world.toSave({ game: manifest.id, playSeconds: 0 });
    const stale = { ...save, switches: { ...save.switches, removed_flag: true } };
    const restored = World.fromSave(stale, { manifest, map: house, tileset, database: db });
    expect(restored.state.toData().switches).toEqual({ accepted_request: true });
  });

  it('rejects a save for a different map than the one given', () => {
    const save = progressedWorld().toSave({ game: manifest.id, playSeconds: 0 });
    expect(() => World.fromSave(save, { manifest, map: meadow, tileset, database: db })).toThrow(
      /save is on map "house"/,
    );
  });

  it('refuses to save while an event is running', () => {
    const world = progressedWorld();
    world.run([{ type: 'message', text: 'hi' }]);
    expect(() => world.toSave({ game: manifest.id, playSeconds: 0 })).toThrow(/event is running/);
  });
});
