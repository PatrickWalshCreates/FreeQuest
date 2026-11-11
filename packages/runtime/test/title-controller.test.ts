import { type Action, ActionState, World } from '@freequest/core';
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { MemoryStorage, SaveStore } from '../src/save-store.js';
import { TitleController } from '../src/title-controller.js';
import { demoDb, readDemo } from './demo.js';

const manifest = parseProjectFile('manifest', readDemo('project.json'));

function save(gold: number, savedAt: string) {
  const world = new World({
    manifest,
    map: parseProjectFile('map', readDemo('data/maps/map001.json')),
    tileset: parseProjectFile('tileset', readDemo('data/tilesets/overworld.json')),
    database: demoDb(),
  });
  world.party.gainGold(gold);
  return world.toSave({ game: manifest.id, playSeconds: 1, savedAt: new Date(savedAt) });
}

function setup(fill: (store: SaveStore, storage: MemoryStorage) => void = () => undefined) {
  const storage = new MemoryStorage();
  const store = new SaveStore(storage, manifest);
  fill(store, storage);
  const title = new TitleController(manifest.name, store);
  const input = new ActionState();
  const tap = (action: Action, times = 1) => {
    for (let i = 0; i < times; i++) {
      input.press(action);
      title.update(input);
      input.endStep();
      input.release(action);
    }
  };
  return { title, tap };
}

describe('TitleController', () => {
  it('only offers New Game without saves', () => {
    const { title, tap } = setup();
    expect(title.state.options.map((o) => [o.label, o.enabled])).toEqual([
      ['New Game', true],
      ['Continue', false],
      ['Load', false],
      ['Options', true],
    ]);
    tap('down');
    tap('confirm'); // Continue is disabled
    expect(title.choice).toBeNull();
    tap('up');
    tap('confirm');
    expect(title.choice).toEqual({ kind: 'new' });
  });

  it('starts on Continue and loads the most recent save', () => {
    const { title, tap } = setup((store) => {
      store.write(1, save(10, '2026-01-01T00:00:00Z'));
      store.write(2, save(20, '2026-02-01T00:00:00Z'));
    });
    expect(title.state.cursor).toBe(1);
    tap('confirm');
    expect(title.choice?.kind === 'load' && title.choice.save.party.gold).toBe(70);
  });

  it('loads a chosen slot and refuses broken ones', () => {
    const { title, tap } = setup((store, storage) => {
      store.write(1, save(10, '2026-01-01T00:00:00Z'));
      storage.setItem('freequest:FreeQuest%20Demo:save:2', 'garbage');
    });
    tap('down');
    tap('confirm'); // Load
    expect(title.state.screen).toBe('load');
    expect(title.state.options.map((o) => o.enabled)).toEqual([true, false, false]);
    tap('down');
    tap('confirm'); // broken slot 2
    expect(title.state.message).toMatch(/can't be loaded/);
    expect(title.choice).toBeNull();
    tap('cancel');
    expect(title.state.screen).toBe('main');
    tap('confirm'); // Load again
    tap('confirm'); // slot 1
    expect(title.choice?.kind === 'load' && title.choice.save.party.gold).toBe(60);
  });

  it('resets back to the main options with an optional message', () => {
    const { title, tap } = setup();
    tap('confirm');
    title.reset('Could not load the save.');
    expect(title.choice).toBeNull();
    expect(title.state.message).toBe('Could not load the save.');
  });
});
