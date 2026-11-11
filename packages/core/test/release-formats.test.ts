// A save made by FreeQuest 0.1.0 (packages/schema/test/fixtures/release-0.1)
// must load in every later version, into the 0.1 project it was made with.
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../schema/test/fixtures/release-0.1/project.json' with { type: 'json' };
import rawHouse from '../../schema/test/fixtures/release-0.1/data/maps/house.json' with { type: 'json' };
import rawSave from '../../schema/test/fixtures/release-0.1/save-slot-1.json' with { type: 'json' };
import rawTileset from '../../schema/test/fixtures/release-0.1/data/tilesets/overworld.json' with { type: 'json' };
import actors from '../../schema/test/fixtures/release-0.1/data/database/actors.json' with { type: 'json' };
import classes from '../../schema/test/fixtures/release-0.1/data/database/classes.json' with { type: 'json' };
import enemies from '../../schema/test/fixtures/release-0.1/data/database/enemies.json' with { type: 'json' };
import equipment from '../../schema/test/fixtures/release-0.1/data/database/equipment.json' with { type: 'json' };
import items from '../../schema/test/fixtures/release-0.1/data/database/items.json' with { type: 'json' };
import skills from '../../schema/test/fixtures/release-0.1/data/database/skills.json' with { type: 'json' };
import states from '../../schema/test/fixtures/release-0.1/data/database/states.json' with { type: 'json' };
import system from '../../schema/test/fixtures/release-0.1/data/database/system.json' with { type: 'json' };
import troops from '../../schema/test/fixtures/release-0.1/data/database/troops.json' with { type: 'json' };
import { DatabaseIndex, World } from '../src/index.js';

describe('a 0.1 save', () => {
  it('loads into the 0.1 project where it was saved', () => {
    const database = new DatabaseIndex(
      assembleDatabase({
        actors: parseProjectFile('actors', actors),
        classes: parseProjectFile('classes', classes),
        enemies: parseProjectFile('enemies', enemies),
        equipment: parseProjectFile('equipment', equipment),
        items: parseProjectFile('items', items),
        skills: parseProjectFile('skills', skills),
        states: parseProjectFile('states', states),
        system: parseProjectFile('system', system),
        troops: parseProjectFile('troops', troops),
      }),
    );
    const save = parseProjectFile('save', rawSave);
    const world = World.fromSave(save, {
      manifest: parseProjectFile('manifest', rawManifest),
      map: parseProjectFile('map', rawHouse),
      tileset: parseProjectFile('tileset', rawTileset),
      database,
    });
    expect(world.map.id).toBe('house');
    expect({ x: world.player.x, y: world.player.y }).toEqual({ x: 3, y: 4 });
    expect(world.state.getSwitch('accepted_request')).toBe(true);
    expect(world.state.getVariable('bridge_visits')).toBe(2);
    expect(world.party.gold).toBe(save.party.gold);
    expect(world.party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
    expect(world.party.member('hero')?.hp).toBe(17);
  });
});
