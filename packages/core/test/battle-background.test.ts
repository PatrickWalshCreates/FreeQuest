// M16 step 1: the picture behind battles: the battle command's own, else the
// one an event chose (kept in saves), else the map's, else the project's.
import {
  type Command,
  type GameMap,
  SAVE_FORMAT_VERSION,
  migrate,
  parseProjectFile,
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
const { battleBackground: _, ...plainMeadow } = meadow;
const withBackground = (map: GameMap, image: string): GameMap => ({
  ...map,
  battleBackground: image,
});

function world(map: GameMap, system: Record<string, unknown> = {}) {
  return new World({ manifest, map, tileset, database: demoDb(system) });
}

function run(w: World, commands: readonly Command[]) {
  const interpreter = w.run(commands, null);
  for (let i = 0; i < 100 && w.interpreter === interpreter; i++) w.step(1 / 60, new ActionState());
}

const change = (image: string | null): Command => ({ type: 'changeBattleBackground', image });

describe('battle backgrounds', () => {
  it('come from the battle command, the map, then the project', () => {
    const none = world(plainMeadow, { battleBackground: undefined });
    expect(none.battleBackgroundFor()).toBeNull();
    const project = world(plainMeadow, { battleBackground: 'assets/battlebacks/sky.png' });
    expect(project.battleBackgroundFor()).toBe('assets/battlebacks/sky.png');
    const map = world(withBackground(plainMeadow, 'assets/battlebacks/meadow.png'), {
      battleBackground: 'assets/battlebacks/sky.png',
    });
    expect(map.battleBackgroundFor()).toBe('assets/battlebacks/meadow.png');
    expect(map.battleBackgroundFor('assets/battlebacks/cave.png')).toBe(
      'assets/battlebacks/cave.png',
    );
  });

  it('can be changed by an event for the rest of the game, over every map’s own', () => {
    const w = world(withBackground(plainMeadow, 'assets/battlebacks/meadow.png'));
    run(w, [change('assets/battlebacks/storm.png')]);
    expect(w.battleBackgroundFor()).toBe('assets/battlebacks/storm.png');
    w.changeMap(withBackground(house, 'assets/battlebacks/inside.png'), tileset, 1, 1);
    expect(w.battleBackgroundFor()).toBe('assets/battlebacks/storm.png');
    // A battle's own still wins.
    expect(w.battleBackgroundFor('assets/battlebacks/cave.png')).toBe(
      'assets/battlebacks/cave.png',
    );
    run(w, [change(null)]);
    expect(w.battleBackgroundFor()).toBe('assets/battlebacks/inside.png');
  });

  it('asks for the battle with its own background', () => {
    const w = world(plainMeadow);
    w.run(
      [
        {
          type: 'battle',
          troop: 'slimes',
          canEscape: true,
          canLose: false,
          background: 'assets/b.png',
        },
      ],
      null,
    );
    w.step(1 / 60, new ActionState());
    expect(w.interpreter?.pending).toMatchObject({ type: 'battle', background: 'assets/b.png' });
  });

  it('keeps an event’s choice in saves (v5), and older saves have none', () => {
    const w = world(plainMeadow);
    run(w, [change('assets/battlebacks/storm.png')]);
    const save = w.toSave({ game: 'g', playSeconds: 1 });
    expect(save.battleBackground).toBe('assets/battlebacks/storm.png');
    const loaded = World.fromSave(save, {
      manifest,
      map: plainMeadow,
      tileset,
      database: demoDb(),
    });
    expect(loaded.battleBackground).toBe('assets/battlebacks/storm.png');
    run(loaded, [change(null)]);
    expect(loaded.toSave({ game: 'g', playSeconds: 1 }).battleBackground).toBeUndefined();
    expect(migrate('save', { formatVersion: 4, game: 'g' })).toEqual({
      formatVersion: SAVE_FORMAT_VERSION,
      game: 'g',
    });
  });
});
