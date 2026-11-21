// A save made by FreeQuest 0.5.0 (packages/schema/test/fixtures/release-0.5): Mira renamed and in
// the party, the chest opened, the elder's map shown as a picture, saving turned off, another
// battle music and a tint must load in every later version into the 0.5 project.
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../schema/test/fixtures/release-0.5/project.json' with { type: 'json' };
import rawHouse from '../../schema/test/fixtures/release-0.5/data/maps/house.json' with { type: 'json' };
import rawSave from '../../schema/test/fixtures/release-0.5/save-slot-1.json' with { type: 'json' };
import rawTileset from '../../schema/test/fixtures/release-0.5/data/tilesets/overworld.json' with { type: 'json' };
import system from '../../schema/test/fixtures/release-0.5/data/database/system.json' with { type: 'json' };
import actors from '../../schema/test/fixtures/release-0.5/data/database/actors.json' with { type: 'json' };
import classes from '../../schema/test/fixtures/release-0.5/data/database/classes.json' with { type: 'json' };
import skills from '../../schema/test/fixtures/release-0.5/data/database/skills.json' with { type: 'json' };
import items from '../../schema/test/fixtures/release-0.5/data/database/items.json' with { type: 'json' };
import equipment from '../../schema/test/fixtures/release-0.5/data/database/equipment.json' with { type: 'json' };
import states from '../../schema/test/fixtures/release-0.5/data/database/states.json' with { type: 'json' };
import enemies from '../../schema/test/fixtures/release-0.5/data/database/enemies.json' with { type: 'json' };
import troops from '../../schema/test/fixtures/release-0.5/data/database/troops.json' with { type: 'json' };
import commonEvents from '../../schema/test/fixtures/release-0.5/data/database/commonEvents.json' with { type: 'json' };
import animations from '../../schema/test/fixtures/release-0.5/data/database/animations.json' with { type: 'json' };
import { DatabaseIndex, World } from '../src/index.js';

describe('a 0.5 save', () => {
  it('loads into the 0.5 project with everything 0.5 saves', () => {
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
      map: parseProjectFile('map', rawHouse),
      tileset: parseProjectFile('tileset', rawTileset),
      database,
    });
    expect(world.map.id).toBe('house');
    expect(world.state.getFlag('house', 'chest', 'opened')).toBe(true);
    expect(world.party.members.map((m) => m.name)).toEqual(['Hero', 'Mira the Bold']);
    expect(world.pictures.list).toMatchObject([
      { number: 1, image: 'assets/pictures/meadow-map.png', x: 240, y: 150, opacity: 1 },
    ]);
    expect(world.access).toEqual({ menu: true, saving: false, formation: true });
    expect(world.battleMusic).toEqual({ battle: 'assets/audio/battle.wav' });
    expect(world.screen.toData().tint).toEqual({ color: '#203060', strength: 0.3 });
    expect(world.playSeconds).toBe(1234);
  });
});
