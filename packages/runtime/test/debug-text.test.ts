import { DatabaseIndex, World } from '@freequest/core';
import {
  DATABASE_KINDS,
  type DatabaseFiles,
  type GameMap,
  type Manifest,
  type Tileset,
  assembleDatabase,
  parseProjectFile,
} from '@freequest/schema';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeGame } from '../src/debug-text.js';

const DEMO = join(import.meta.dirname, '..', '..', '..', 'samples', 'demo-project');
const read = (path: string): unknown => JSON.parse(readFileSync(join(DEMO, path), 'utf8'));

describe('describeGame', () => {
  it('summarizes position, party, inventory and flags', () => {
    const manifest: Manifest = parseProjectFile('manifest', read('project.json'));
    const files = Object.fromEntries(
      DATABASE_KINDS.map((k) => [k, parseProjectFile(k, read(`data/database/${k}.json`))]),
    ) as DatabaseFiles;
    const map: GameMap = parseProjectFile('map', read('data/maps/map001.json'));
    const tileset: Tileset = parseProjectFile('tileset', read('data/tilesets/overworld.json'));
    const world = new World({
      manifest,
      map,
      tileset,
      database: new DatabaseIndex(assembleDatabase(files)),
    });
    world.party.gain('item', 'potion', 2);
    world.party.member('hero')?.addState('poison');
    world.state.setSwitch('accepted_request', true);
    world.state.setVariable('bridge_visits', 3);

    const text = describeGame(world, manifest);
    expect(text).toContain('Map map001 (7, 7) facing down · 0 steps');
    expect(text).toContain('Gold: 50 G');
    expect(text).toMatch(/Hero\s+Lv {2}1 {2}HP 120\/120 {2}MP \d+\/\d+ {2}\[poison\]/);
    expect(text).toContain('Items: Potion ×2');
    expect(text).toContain('Equipment: —');
    expect(text).toContain('● accepted_request');
    expect(text).toContain('○ rewarded');
    expect(text).toContain('bridge_visits = 3');
  });
});
