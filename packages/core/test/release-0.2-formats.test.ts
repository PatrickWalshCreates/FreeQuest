// A save made by FreeQuest 0.2.0 (packages/schema/test/fixtures/release-0.2), with event
// flags and a screen tint, must load in every later version into the 0.2 project.
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../schema/test/fixtures/release-0.2/project.json' with { type: 'json' };
import rawHouse from '../../schema/test/fixtures/release-0.2/data/maps/house.json' with { type: 'json' };
import rawSave from '../../schema/test/fixtures/release-0.2/save-slot-1.json' with { type: 'json' };
import rawTileset from '../../schema/test/fixtures/release-0.2/data/tilesets/overworld.json' with { type: 'json' };
import actors from '../../schema/test/fixtures/release-0.2/data/database/actors.json' with { type: 'json' };
import classes from '../../schema/test/fixtures/release-0.2/data/database/classes.json' with { type: 'json' };
import commonEvents from '../../schema/test/fixtures/release-0.2/data/database/commonEvents.json' with { type: 'json' };
import enemies from '../../schema/test/fixtures/release-0.2/data/database/enemies.json' with { type: 'json' };
import equipment from '../../schema/test/fixtures/release-0.2/data/database/equipment.json' with { type: 'json' };
import items from '../../schema/test/fixtures/release-0.2/data/database/items.json' with { type: 'json' };
import skills from '../../schema/test/fixtures/release-0.2/data/database/skills.json' with { type: 'json' };
import states from '../../schema/test/fixtures/release-0.2/data/database/states.json' with { type: 'json' };
import system from '../../schema/test/fixtures/release-0.2/data/database/system.json' with { type: 'json' };
import troops from '../../schema/test/fixtures/release-0.2/data/database/troops.json' with { type: 'json' };
import { DatabaseIndex, World } from '../src/index.js';

describe('a 0.2 save', () => {
  it('loads into the 0.2 project, flags and tint included', () => {
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
    expect(world.screen.tint).toEqual({ color: '#203060', strength: 0.35 });
    expect(world.party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
  });
});
