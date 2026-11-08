import { describe, expect, it } from 'vitest';
import { CollisionMap } from '../src/index.js';
import { makeMap, tileset } from './fixtures.js';

describe('CollisionMap', () => {
  it('derives passability from tileset flags', () => {
    const c = CollisionMap.fromMap(makeMap(['.#', '..']), tileset);
    expect(c.isPassable(0, 0)).toBe(true);
    expect(c.isPassable(1, 0)).toBe(false);
    expect(c.isPassable(1, 1)).toBe(true);
  });

  it('treats cells outside the map as impassable', () => {
    const c = CollisionMap.fromMap(makeMap(['..', '..']), tileset);
    expect(c.isPassable(-1, 0)).toBe(false);
    expect(c.isPassable(0, -1)).toBe(false);
    expect(c.isPassable(2, 0)).toBe(false);
    expect(c.isPassable(0, 2)).toBe(false);
    expect(c.isPassable(0.5, 0)).toBe(false);
  });

  it('blocks a cell if any layer has an impassable tile', () => {
    const c = CollisionMap.fromMap(makeMap(['..'], ['#o']), tileset);
    expect(c.isPassable(0, 0)).toBe(false);
    expect(c.isPassable(1, 0)).toBe(true);
  });

  it('ignores "above" tiles for collision', () => {
    const c = CollisionMap.fromMap(makeMap(['.#'], ['TT']), tileset);
    expect(c.isPassable(0, 0)).toBe(true);
    expect(c.isPassable(1, 0)).toBe(false);
  });

  it('treats cells with no collidable tile as impassable', () => {
    const c = CollisionMap.fromMap(makeMap([' .'], ['T ']), tileset);
    expect(c.isPassable(0, 0)).toBe(false);
    expect(c.isPassable(1, 0)).toBe(true);
  });

  it('rejects tile indices missing from the tileset', () => {
    const map = makeMap(['.']);
    map.layers[0]?.data[0]?.splice(0, 1, 99);
    expect(() => CollisionMap.fromMap(map, tileset)).toThrow(/tile 99/);
  });
});
