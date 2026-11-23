// M17 step 1: the look of windows (system `ui`) and Change window colour.
import {
  type Command,
  DEFAULT_WINDOW_LOOK,
  SAVE_FORMAT_VERSION,
  migrate,
  parseProjectFile,
  resolveWindowLook,
} from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawHouse from '../../../samples/demo-project/data/maps/house.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { ActionState, World } from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const tileset = parseProjectFile('tileset', rawTileset);
const meadow = parseProjectFile('map', rawMap);
const house = parseProjectFile('map', rawHouse);

function world() {
  return new World({ manifest, map: meadow, tileset, database: demoDb() });
}

function run(w: World, commands: readonly Command[]) {
  const interpreter = w.run(commands, null);
  for (let i = 0; i < 100 && w.interpreter === interpreter; i++) w.step(1 / 60, new ActionState());
}

const change = (windowColor: string | null): Command => ({
  type: 'changeWindowColor',
  windowColor,
});

describe('the look of windows', () => {
  it('is FreeQuest’s own where the project leaves it out', () => {
    expect(resolveWindowLook(undefined)).toBe(DEFAULT_WINDOW_LOOK);
    const look = resolveWindowLook({
      windowColor: '#203040',
      fontSize: 21,
      textColors: { red: '#ff0000' },
    });
    expect(look.windowColor).toBe('#203040');
    expect(look.borderColor).toBe(DEFAULT_WINDOW_LOOK.borderColor);
    // A bigger font gets proportionally more room per line.
    expect(look.lineHeight).toBe(27);
    expect(look.textColors.red).toBe('#ff0000');
    expect(look.textColors.blue).toBe(DEFAULT_WINDOW_LOOK.textColors.blue);
    expect(resolveWindowLook({ fontSize: 21, lineHeight: 22 }).lineHeight).toBe(22);
  });

  it('is checked by the system schema', () => {
    expect(() =>
      parseProjectFile('system', {
        formatVersion: 7,
        currency: 'G',
        elements: [],
        equipmentSlots: [],
        equipmentTypes: [],
        skillTypes: [],
        ui: { windowColor: 'blue' },
      }),
    ).toThrow();
  });
});

describe('Change window colour', () => {
  it('lasts the rest of the game, across maps, until set back', () => {
    const w = world();
    expect(w.windowColor).toBeNull();
    run(w, [change('#402030')]);
    expect(w.windowColor).toBe('#402030');
    w.changeMap(house, tileset, 1, 1);
    expect(w.windowColor).toBe('#402030');
    run(w, [change(null)]);
    expect(w.windowColor).toBeNull();
  });

  it('is kept in saves (v6); older and damaged saves have none', () => {
    const w = world();
    run(w, [change('#402030')]);
    const save = w.toSave({ game: 'g', playSeconds: 1 });
    expect(save.windowColor).toBe('#402030');
    const load = (data: typeof save) =>
      World.fromSave(data, { manifest, map: meadow, tileset, database: demoDb() });
    expect(load(save).windowColor).toBe('#402030');
    expect(load({ ...save, windowColor: 'url(evil)' }).windowColor).toBeNull();
    const { windowColor: _, ...older } = save;
    expect(load(older).windowColor).toBeNull();
    run(w, [change(null)]);
    expect(w.toSave({ game: 'g', playSeconds: 1 }).windowColor).toBeUndefined();
    expect(migrate('save', { formatVersion: 5, game: 'g' })).toEqual({
      formatVersion: SAVE_FORMAT_VERSION,
      game: 'g',
    });
  });
});
