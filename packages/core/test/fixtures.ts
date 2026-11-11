import type { GameMap, Manifest, Tileset } from '@freequest/schema';

// Tile 0: floor, 1: wall, 2: treetop (above, impassable flag ignored), 3: floor with passable overlay.
export const tileset: Tileset = {
  formatVersion: 1,
  id: 'test',
  name: 'Test',
  image: 'test.png',
  tileWidth: 16,
  tileHeight: 16,
  columns: 4,
  tiles: [
    { passable: true },
    { passable: false },
    { passable: false, above: true },
    { passable: true },
  ],
};

/** Parse rows like "..#" where "." = floor, "#" = wall, " " = empty. */
export function makeMap(rows: string[], overlay?: string[]): GameMap {
  const toData = (lines: string[], legend: Record<string, number>) =>
    lines.map((line) => [...line].map((ch) => legend[ch] ?? -1));
  const layers = [{ name: 'ground', data: toData(rows, { '.': 0, '#': 1 }) }];
  if (overlay) layers.push({ name: 'overlay', data: toData(overlay, { T: 2, '#': 1, o: 3 }) });
  return {
    formatVersion: 6,
    id: 'test-map',
    name: 'Test map',
    width: rows[0]?.length ?? 0,
    height: rows.length,
    tileset: 'test',
    layers,
    events: [],
  };
}

export function makeManifest(start: Partial<Manifest['start']> = {}): Manifest {
  return {
    formatVersion: 5,
    id: 'test-game',
    name: 'Test',
    screen: { width: 64, height: 64 },
    start: { map: 'test-map', x: 0, y: 0, direction: 'down', party: [], gold: 0, ...start },
    player: { character: 'hero', speed: 4 },
    tilesets: [],
    maps: [],
    characters: [],
    switches: [],
    variables: [],
  };
}
