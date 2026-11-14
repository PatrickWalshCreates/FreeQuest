// A save made by FreeQuest 0.3.0 (packages/schema/test/fixtures/release-0.3), with event
// the chest opened and Mira in the party, must load in every later version into the
// 0.3 project, whose messages have faces (map 8).
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../schema/test/fixtures/release-0.3/project.json' with { type: 'json' };
import rawHouse from '../../schema/test/fixtures/release-0.3/data/maps/house.json' with { type: 'json' };
import rawSave from '../../schema/test/fixtures/release-0.3/save-slot-1.json' with { type: 'json' };
import rawTileset from '../../schema/test/fixtures/release-0.3/data/tilesets/overworld.json' with { type: 'json' };
import actors from '../../schema/test/fixtures/release-0.3/data/database/actors.json' with { type: 'json' };
import classes from '../../schema/test/fixtures/release-0.3/data/database/classes.json' with { type: 'json' };
import commonEvents from '../../schema/test/fixtures/release-0.3/data/database/commonEvents.json' with { type: 'json' };
import enemies from '../../schema/test/fixtures/release-0.3/data/database/enemies.json' with { type: 'json' };
import equipment from '../../schema/test/fixtures/release-0.3/data/database/equipment.json' with { type: 'json' };
import items from '../../schema/test/fixtures/release-0.3/data/database/items.json' with { type: 'json' };
import skills from '../../schema/test/fixtures/release-0.3/data/database/skills.json' with { type: 'json' };
import states from '../../schema/test/fixtures/release-0.3/data/database/states.json' with { type: 'json' };
import system from '../../schema/test/fixtures/release-0.3/data/database/system.json' with { type: 'json' };
import troops from '../../schema/test/fixtures/release-0.3/data/database/troops.json' with { type: 'json' };
import { DatabaseIndex, World } from '../src/index.js';

describe('a 0.3 save', () => {
  it('loads into the 0.3 project', () => {
    const database = new DatabaseIndex(
      assembleDatabase({
        actors: parseProjectFile('actors', actors),
        classes: parseProjectFile('classes', classes),
        commonEvents: parseProjectFile('commonEvents', commonEvents),
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
    expect(world.state.getFlag('house', 'chest', 'opened')).toBe(true);
    // The opened chest shows its second page straight away.
    expect(world.events.find((e) => e.id === 'chest')?.pageIndex).toBe(1);
    expect(world.state.getVariable('bridge_visits')).toBe(2);
    expect(world.party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
    expect(world.party.gold).toBe(107);
    // 0.3's map format: Mira's line in the house shows her face.
    expect(JSON.stringify(rawHouse)).toContain(
      '"face":{"image":"assets/faces/mira.png","index":1}',
    );
  });
});
