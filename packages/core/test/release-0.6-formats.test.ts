// A save made by FreeQuest 0.6.0 (packages/schema/test/fixtures/release-0.6): the elder's
// request accepted, rain on the meadow and the HUD hidden (plugin data, save v4) must load in
// every later version into the 0.6 project, the plugins' data intact.
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../schema/test/fixtures/release-0.6/project.json' with { type: 'json' };
import rawMap from '../../schema/test/fixtures/release-0.6/data/maps/map001.json' with { type: 'json' };
import rawSave from '../../schema/test/fixtures/release-0.6/save-slot-1.json' with { type: 'json' };
import rawTileset from '../../schema/test/fixtures/release-0.6/data/tilesets/overworld.json' with { type: 'json' };
import system from '../../schema/test/fixtures/release-0.6/data/database/system.json' with { type: 'json' };
import actors from '../../schema/test/fixtures/release-0.6/data/database/actors.json' with { type: 'json' };
import classes from '../../schema/test/fixtures/release-0.6/data/database/classes.json' with { type: 'json' };
import skills from '../../schema/test/fixtures/release-0.6/data/database/skills.json' with { type: 'json' };
import items from '../../schema/test/fixtures/release-0.6/data/database/items.json' with { type: 'json' };
import equipment from '../../schema/test/fixtures/release-0.6/data/database/equipment.json' with { type: 'json' };
import states from '../../schema/test/fixtures/release-0.6/data/database/states.json' with { type: 'json' };
import enemies from '../../schema/test/fixtures/release-0.6/data/database/enemies.json' with { type: 'json' };
import troops from '../../schema/test/fixtures/release-0.6/data/database/troops.json' with { type: 'json' };
import commonEvents from '../../schema/test/fixtures/release-0.6/data/database/commonEvents.json' with { type: 'json' };
import animations from '../../schema/test/fixtures/release-0.6/data/database/animations.json' with { type: 'json' };
import { DatabaseIndex, World } from '../src/index.js';

describe('a 0.6 save', () => {
  it('loads into the 0.6 project with its plugins’ data', () => {
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
    expect(world.state.getSwitch('accepted_request')).toBe(true);
    expect(world.state.getVariable('bridge_visits')).toBe(2);
    expect(Object.fromEntries(world.pluginData)).toEqual({
      weather: { map: 'map001', kind: 'rain', strength: 0.8 },
      hud: { hidden: true },
    });
    expect(world.playSeconds).toBe(2345);
  });
});
