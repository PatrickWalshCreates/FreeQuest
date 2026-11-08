import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { ActionState, World } from '../src/index.js';

describe('demo project', () => {
  const world = new World({
    manifest: parseProjectFile('manifest', rawManifest),
    map: parseProjectFile('map', rawMap),
    tileset: parseProjectFile('tileset', rawTileset),
  });

  it('starts the player on a passable tile', () => {
    expect(world.collision.isPassable(world.player.x, world.player.y)).toBe(true);
  });

  it('is enclosed: walking in any direction never leaves the map', () => {
    const input = new ActionState();
    for (const dir of ['up', 'left', 'down', 'right'] as const) {
      input.releaseAll();
      input.press(dir);
      for (let i = 0; i < 600; i++) world.step(1 / 60, input);
      expect(world.collision.inBounds(world.player.x, world.player.y)).toBe(true);
    }
  });
});
