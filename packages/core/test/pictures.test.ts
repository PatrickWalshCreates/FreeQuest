// Pictures over the map: show, move over time with easing, erase; kept across maps and in saves.
import { type Command, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { ActionState, Pictures, World, ease } from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const tileset = parseProjectFile('tileset', rawTileset);
const world = () => new World({ manifest, map, tileset, database: demoDb() });
const look = { origin: 'top-left', x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1 } as const;

const show: Command = {
  type: 'showPicture',
  number: 2,
  image: 'assets/images/sky.png',
  origin: 'center',
  x: 100,
  y: 50,
  scaleX: 100,
  scaleY: 100,
  opacity: 0,
};

function steps(w: World, n: number) {
  const input = new ActionState();
  for (let i = 0; i < n; i++) w.step(1 / 60, input);
}

describe('pictures', () => {
  it('shows a picture, sized in percent, from numbers or variables', () => {
    const w = world();
    w.state.setVariable('bridge_visits', 40);
    w.run([show, { ...show, number: 1, x: { variable: 'bridge_visits' }, scaleX: 50 }]);
    steps(w, 1);
    expect(w.pictures.list).toEqual([
      {
        number: 1,
        image: 'assets/images/sky.png',
        origin: 'center',
        x: 40,
        y: 50,
        scaleX: 0.5,
        scaleY: 1,
        opacity: 0,
      },
      {
        number: 2,
        image: 'assets/images/sky.png',
        origin: 'center',
        x: 100,
        y: 50,
        scaleX: 1,
        scaleY: 1,
        opacity: 0,
      },
    ]);
  });

  it('moves and fades over time, waiting when asked, then erases', () => {
    const w = world();
    const interpreter = w.run([
      show,
      {
        type: 'movePicture',
        number: 2,
        origin: 'center',
        x: 200,
        y: 50,
        scaleX: 200,
        scaleY: 100,
        opacity: 1,
        seconds: 1,
        easing: 'linear',
        wait: true,
      },
      { type: 'erasePicture', number: 2 },
    ]);
    steps(w, 31);
    const half = w.pictures.list[0];
    expect(half?.x).toBeGreaterThan(140);
    expect(half?.x).toBeLessThan(160);
    expect(half?.opacity).toBeCloseTo(((half?.x ?? 0) - 100) / 100);
    expect(w.interpreter).toBe(interpreter);
    steps(w, 40);
    expect(w.interpreter).toBeNull();
    expect(w.pictures.list).toEqual([]);
  });

  it('eases in and out', () => {
    expect(ease('ease-in', 0.5)).toBe(0.25);
    expect(ease('ease-out', 0.5)).toBe(0.75);
    expect(ease('ease-in-out', 0.25)).toBe(0.125);
    expect(ease('ease-in-out', 1)).toBe(1);
  });

  it('a move of a missing picture, or one replaced, counts as finished', () => {
    const pictures = new Pictures();
    expect(pictures.move(5, look, 1, 'linear')()).toBe(true);
    pictures.show(5, 'a.png', look);
    const done = pictures.move(5, { ...look, x: 10 }, 1, 'linear');
    expect(done()).toBe(false);
    pictures.show(5, 'b.png', look);
    expect(done()).toBe(true);
  });

  it('stays across maps and is kept in saves (where it is now)', () => {
    const w = world();
    w.run([show]);
    steps(w, 1);
    w.changeMap(map, tileset, 7, 7);
    expect(w.pictures.list).toHaveLength(1);
    const save = w.toSave({ game: manifest.id, playSeconds: 0 });
    expect(save.pictures).toHaveLength(1);
    const loaded = World.fromSave(save, { manifest, map, tileset, database: demoDb() });
    expect(loaded.pictures.list).toEqual(w.pictures.list);
    // No pictures: no field.
    expect(world().toSave({ game: manifest.id, playSeconds: 0 }).pictures).toBeUndefined();
  });
});
