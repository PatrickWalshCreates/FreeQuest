import { ActionState, type Battle, World } from '@freequest/core';
import type { Command, GameMap, Manifest, Tileset } from '@freequest/schema';
import { describe, expect, it, vi } from 'vitest';
import type { BattleController } from '../src/battle-controller.js';
import { BattleFlow } from '../src/battle-flow.js';
import { demoDb, readDemo } from './demo.js';
import { parseProjectFile } from '@freequest/schema';

const db = demoDb();
const DT = 1 / 60;

function setup(options: { encounters?: boolean; prepare?: () => Promise<void> } = {}) {
  const manifest: Manifest = parseProjectFile('manifest', readDemo('project.json'));
  const tileset: Tileset = parseProjectFile('tileset', readDemo('data/tilesets/overworld.json'));
  const base: GameMap = parseProjectFile('map', readDemo('data/maps/map001.json'));
  const map: GameMap = options.encounters
    ? { ...base, encounters: { steps: 1, troops: [{ troop: 'slimes', weight: 1 }] } }
    : base;
  const world = new World({ manifest, map, tileset, database: db, random: () => 0 });
  for (const m of world.party.members) {
    m.changeLevel(30);
    m.recoverAll();
  }
  const hooks = {
    prepare: vi.fn(options.prepare ?? (() => Promise.resolve())),
    begin: vi.fn<(battle: Battle, controller: BattleController) => void>(),
    end: vi.fn(),
    gameOver: vi.fn(),
  };
  const flow = new BattleFlow(db, hooks, {
    fadeSeconds: 0.1,
    random: () => 0.1,
    lineSeconds: 0.05,
  });
  const input = new ActionState();
  /** One game step in the same order as the runtime. */
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      flow.update(DT, world, input);
      if (!flow.active) world.step(DT, input);
      input.endStep();
    }
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  /** Press confirm through the whole battle screen. */
  const fightThrough = () => {
    for (let i = 0; i < 2000 && flow.controller?.outcome === null; i++) {
      input.press('confirm');
      tick();
      input.release('confirm');
      tick();
    }
  };
  return { world, flow, hooks, input, tick, flush, fightThrough };
}

const battleCommand = (canLose: boolean): Command => ({
  type: 'battle',
  troop: 'slimes',
  canEscape: false,
  canLose,
  onWin: [{ type: 'changeGold', amount: 1000 }],
  onLose: [{ type: 'changeGold', amount: 1 }],
});

describe('BattleFlow', () => {
  it('runs an event battle: fade out, fight, fade back, then the win branch', async () => {
    const { world, flow, hooks, tick, flush, fightThrough } = setup();
    world.run([battleCommand(false)]);
    tick(2); // the world runs the event to its battle request; the flow picks it up
    expect(flow.active).toBe(true);
    expect(hooks.prepare).toHaveBeenCalledWith('slimes');
    await flush();
    tick(3);
    expect(flow.fade).toBeGreaterThan(0);
    tick(10);
    expect(hooks.begin).toHaveBeenCalledOnce();
    const goldBefore = world.party.gold;
    fightThrough();
    tick(30);
    expect(hooks.end).toHaveBeenCalledOnce();
    expect(flow.active).toBe(false);
    expect(world.party.gold).toBe(goldBefore + 16 + 1000); // battle gold + onWin
  });

  it('starts random encounters and returns to the map', async () => {
    const { world, flow, hooks, input, tick, flush, fightThrough } = setup({ encounters: true });
    input.press('down');
    for (let i = 0; i < 60 && !flow.active; i++) tick();
    input.release('down');
    expect(flow.active).toBe(true);
    await flush();
    tick(10);
    expect(hooks.begin).toHaveBeenCalledOnce();
    fightThrough();
    tick(30);
    expect(flow.active).toBe(false);
    expect(world.hasPendingEncounter).toBe(false);
  });

  it('is game over when a battle that cannot be lost is lost', async () => {
    const { world, flow, hooks, tick, flush, fightThrough } = setup();
    for (const m of world.party.members) m.setHp(0); // already down: loses at once
    world.run([battleCommand(false)]);
    tick(2); // the world runs the event to its battle request; the flow picks it up
    await flush();
    tick(10);
    fightThrough();
    tick(30);
    expect(hooks.gameOver).toHaveBeenCalledOnce();
    expect(flow.isGameOver).toBe(true);
    expect(flow.fade).toBe(1);
  });

  it('continues the event with onLose when losing is allowed', async () => {
    const { world, flow, hooks, tick, flush, fightThrough } = setup();
    for (const m of world.party.members) m.setHp(0);
    world.run([battleCommand(true)]);
    tick(2);
    await flush();
    tick(10);
    fightThrough();
    tick(30);
    expect(hooks.gameOver).not.toHaveBeenCalled();
    expect(flow.active).toBe(false);
    expect(world.party.gold).toBe(51); // onLose ran
  });

  it('skips a battle whose assets fail to load instead of freezing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { world, flow, hooks, tick, flush } = setup({
      prepare: () => Promise.reject(new Error('404')),
    });
    world.run([battleCommand(false)]);
    tick(2); // the world runs the event to its battle request; the flow picks it up
    await flush();
    tick(30);
    expect(hooks.begin).not.toHaveBeenCalled();
    expect(flow.active).toBe(false);
    expect(world.party.gold).toBe(1050); // unescapable: counted as a win
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
