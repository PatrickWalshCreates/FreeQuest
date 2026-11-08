// The demo project's database, parsed exactly as the runtime would.
import { assembleDatabase, parseProjectFile } from '@freequest/schema';
import actors from '../../../samples/demo-project/data/database/actors.json' with { type: 'json' };
import classes from '../../../samples/demo-project/data/database/classes.json' with { type: 'json' };
import enemies from '../../../samples/demo-project/data/database/enemies.json' with { type: 'json' };
import equipment from '../../../samples/demo-project/data/database/equipment.json' with { type: 'json' };
import items from '../../../samples/demo-project/data/database/items.json' with { type: 'json' };
import skills from '../../../samples/demo-project/data/database/skills.json' with { type: 'json' };
import states from '../../../samples/demo-project/data/database/states.json' with { type: 'json' };
import system from '../../../samples/demo-project/data/database/system.json' with { type: 'json' };
import troops from '../../../samples/demo-project/data/database/troops.json' with { type: 'json' };
import { DatabaseIndex } from '../src/index.js';

export function demoDb(): DatabaseIndex {
  return new DatabaseIndex(
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
    }),
  );
}
