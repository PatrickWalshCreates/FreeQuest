// A save made by FreeQuest 0.7.0 (packages/schema/test/fixtures/release-0.7): Mira leading the
// party, Formation turned off and a battle background an event chose (save v5) must load in
// every later version into the 0.7 project.
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../schema/test/fixtures/release-0.7/project.json' with { type: 'json' };
import rawMap from '../../schema/test/fixtures/release-0.7/data/maps/map001.json' with { type: 'json' };
import rawSave from '../../schema/test/fixtures/release-0.7/save-slot-1.json' with { type: 'json' };
import rawTileset from '../../schema/test/fixtures/release-0.7/data/tilesets/overworld.json' with { type: 'json' };
import system from '../../schema/test/fixtures/release-0.7/data/database/system.json' with { type: 'json' };
import actors from '../../schema/test/fixtures/release-0.7/data/database/actors.json' with { type: 'json' };
import classes from '../../schema/test/fixtures/release-0.7/data/database/classes.json' with { type: 'json' };
import skills from '../../schema/test/fixtures/release-0.7/data/database/skills.json' with { type: 'json' };
import items from '../../schema/test/fixtures/release-0.7/data/database/items.json' with { type: 'json' };
import equipment from '../../schema/test/fixtures/release-0.7/data/database/equipment.json' with { type: 'json' };
import states from '../../schema/test/fixtures/release-0.7/data/database/states.json' with { type: 'json' };
import enemies from '../../schema/test/fixtures/release-0.7/data/database/enemies.json' with { type: 'json' };
import troops from '../../schema/test/fixtures/release-0.7/data/database/troops.json' with { type: 'json' };
import commonEvents from '../../schema/test/fixtures/release-0.7/data/database/commonEvents.json' with { type: 'json' };
import animations from '../../schema/test/fixtures/release-0.7/data/database/animations.json' with { type: 'json' };
import { DatabaseIndex, World } from '../src/index.js';

describe('a 0.7 save', () => {
  it('loads into the 0.7 project with the party order, formation access and battle background', () => {
    const database = new DatabaseIndex(
      assembleDatabase({
        system: parseProjectFile('system', system),
        actors: parseProjectFile('actors', actors),
        classes: parseProjectFile('classes', classes),
        skills: parseProjectFile('skills', skills),
        items: parseProjectFile('items', items),
        equipment: parseProjectFile('equipment', equipment),
        states: parseProjectFile('states', states),
        enemies: parseProjectFile('enemies', enemies),
        troops: parseProjectFile('troops', troops),
        commonEvents: parseProjectFile('commonEvents', commonEvents),
        animations: parseProjectFile('animations', animations),
      }),
    );
    const world = World.fromSave(parseProjectFile('save', rawSave), {
      manifest: parseProjectFile('manifest', rawManifest),
      map: parseProjectFile('map', rawMap),
      tileset: parseProjectFile('tileset', rawTileset),
      database,
    });
    expect(world.map.id).toBe('map001');
    expect(world.party.members.map((m) => m.id)).toEqual(['mira', 'hero']);
    expect(world.playerCharacter).toBe(world.party.members[0]?.character);
    expect(world.access).toEqual({ menu: true, saving: true, formation: false });
    expect(world.battleBackground).toBe('assets/battlebacks/meadow.png');
    expect(world.state.getSwitch('accepted_request')).toBe(true);
    expect(world.playSeconds).toBe(2345);
  });
});
