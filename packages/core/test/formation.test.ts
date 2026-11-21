// M16 step 3: the party's order: the leader (who the player looks like) and
// the front members who fight; moved by events, swapped from the menu.
import { type Command, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { ActionState, Battle, World } from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const tileset = parseProjectFile('tileset', rawTileset);

function world() {
  const w = new World({ manifest, map, tileset, database: demoDb() });
  w.party.addMember('mira');
  return w;
}

function run(w: World, commands: readonly Command[]) {
  const interpreter = w.run(commands, null);
  for (let i = 0; i < 100 && w.interpreter === interpreter; i++) w.step(1 / 60, new ActionState());
}

const ids = (w: World) => w.party.members.map((m) => m.id);

describe('the party’s order', () => {
  it('changes with Move a party member: place 1 leads, past the end is last', () => {
    const w = world();
    const before = w.party.version;
    run(w, [{ type: 'movePartyMember', actor: 'mira', place: 1 }]);
    expect(ids(w)).toEqual(['mira', 'hero']);
    expect(w.party.version).toBeGreaterThan(before);
    // The player looks like the new leader, and Mira fights first.
    expect(w.playerCharacter).toBe(w.party.member('mira')?.character);
    const battle = new Battle({
      db: w.db,
      party: w.party,
      troop: 'slimes',
      state: w.state,
      canEscape: true,
    });
    expect(battle.actors.map((a) => a.id)).toEqual(['mira', 'hero']);
    run(w, [{ type: 'movePartyMember', actor: 'mira', place: 9 }]);
    expect(ids(w)).toEqual(['hero', 'mira']);
    // Not a member: nothing happens.
    run(w, [{ type: 'changeParty', action: 'remove', actor: 'mira' }]);
    run(w, [{ type: 'movePartyMember', actor: 'mira', place: 1 }]);
    expect(ids(w)).toEqual(['hero']);
  });

  it('swaps two places (the menu’s Formation), and is kept in saves', () => {
    const w = world();
    w.party.swapMembers(0, 1);
    expect(ids(w)).toEqual(['mira', 'hero']);
    w.party.swapMembers(0, 5);
    expect(ids(w)).toEqual(['mira', 'hero']);
    const loaded = World.fromSave(w.toSave({ game: 'g', playSeconds: 1 }), {
      manifest,
      map,
      tileset,
      database: demoDb(),
    });
    expect(ids(loaded)).toEqual(['mira', 'hero']);
  });

  it('can be locked by events, which saves keep', () => {
    const w = world();
    run(w, [{ type: 'setAccess', what: 'formation', allowed: false }]);
    expect(w.access.formation).toBe(false);
    const save = w.toSave({ game: 'g', playSeconds: 1 });
    expect(save.access).toEqual({ formation: false });
    const loaded = World.fromSave(save, { manifest, map, tileset, database: demoDb() });
    expect(loaded.access).toEqual({ menu: true, saving: true, formation: false });
  });
});
