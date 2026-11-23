// M17 step 5: tiles' blocked sides (tileset v2): a step crosses neither the side
// it leaves nor the side it enters; diagonals go round one corner or the other.
import type { Tileset } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { CollisionMap, GridMover } from '../src/index.js';
import { makeMap } from './fixtures.js';

// 0: floor, 1: wall, 2: floor fenced along its right side, 3: floor fenced along its top.
const fenced: Tileset = {
  formatVersion: 2,
  id: 'test',
  name: 'Fenced',
  image: 'test.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  tiles: [
    { passable: true },
    { passable: false },
    { passable: true, blocks: ['right'] },
    { passable: true, blocks: ['up'] },
  ],
};

/** "." floor, "#" wall, "|" fence on the right, "^" fence on top. */
function map(rows: string[]) {
  const m = makeMap(rows.map((r) => r.replace(/[|^]/g, '.')));
  const layer = m.layers[0];
  if (!layer) throw new Error('no layer');
  const data = rows.map((r) => [...r].map((c) => ({ '.': 0, '#': 1, '|': 2, '^': 3 })[c] ?? -1));
  return { ...m, layers: [{ ...layer, data }] };
}

describe('blocked sides', () => {
  it('stop a step across them, either way, and nothing else', () => {
    const c = CollisionMap.fromMap(map(['.|.', '.^.']), fenced);
    // The fence is on the right of (1, 0): no crossing to or from (2, 0).
    expect(c.canCross(1, 0, 1, 0)).toBe(false);
    expect(c.canCross(2, 0, -1, 0)).toBe(false);
    expect(c.canCross(0, 0, 1, 0)).toBe(true);
    expect(c.canCross(1, 0, 0, 1)).toBe(false); // into (1, 1), fenced on its top
    expect(c.canCross(1, 1, 0, -1)).toBe(false);
    expect(c.canCross(1, 1, 1, 0)).toBe(true);
    // The cells themselves are still walkable.
    expect(c.isPassable(1, 0)).toBe(true);
    expect(c.isPassable(1, 1)).toBe(true);
  });

  it('turn a mover back at the fence, unless it walks through things', () => {
    const c = CollisionMap.fromMap(map(['.|.']), fenced);
    const mover = new GridMover({ x: 1, y: 0, direction: 'down', speed: 4 });
    expect(mover.tryStep('right', c)).toBe(false);
    expect(mover.direction).toBe('right');
    expect(mover.tryStep('left', c)).toBe(true);
    const ghost = new GridMover({ x: 1, y: 0, direction: 'down', speed: 4 });
    ghost.through = true;
    expect(ghost.tryStep('right', c)).toBe(true);
  });

  it('let a diagonal go round the open corner only', () => {
    // From (1, 0) down-right to (2, 1): right is fenced, but down then right is open.
    const c = CollisionMap.fromMap(map(['.|.', '...']), fenced);
    const mover = new GridMover({ x: 1, y: 0, direction: 'down', speed: 4 });
    expect(mover.tryMove(1, 1, 'down', c)).toBe(true);
    // Both ways fenced: (1, 1) has a fence on top, and (1, 0) one on the right.
    const shut = CollisionMap.fromMap(map(['.|.', '.^.']), fenced);
    expect(
      new GridMover({ x: 1, y: 0, direction: 'down', speed: 4 }).tryMove(1, 1, 'down', shut),
    ).toBe(false);
  });

  it('don’t stop jumps', () => {
    const c = CollisionMap.fromMap(map(['.|.']), fenced);
    expect(new GridMover({ x: 1, y: 0, direction: 'down', speed: 4 }).jump(1, 0, c)).toBe(true);
  });
});
