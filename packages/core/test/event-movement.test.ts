import type { Command, EventMovement, EventPage, MapEvent } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { ActionState, type Direction, World } from '../src/index.js';
import { makeManifest, makeMap, tileset } from './fixtures.js';

const DT = 1 / 60;
const say = (text: string): Command => ({ type: 'message', text });

function walker(movement: EventMovement, overrides: Partial<EventPage> = {}): EventPage {
  return {
    conditions: [],
    trigger: 'action',
    layer: 'same',
    commands: [say('hi')],
    graphic: { character: 'npc', direction: 'down' },
    movement,
    ...overrides,
  };
}

/** A blocking event without movement. */
function still(): EventPage {
  const { movement: _, ...page } = walker({ type: 'random', speed: 1, pause: 0 });
  return page;
}

function event(id: string, x: number, y: number, page: EventPage): MapEvent {
  return { id, name: id, x, y, pages: [page] };
}

/** A sequence of random numbers, repeated. */
function sequence(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

function setup(
  rows: string[],
  events: MapEvent[],
  options: { x?: number; y?: number; direction?: Direction; random?: () => number } = {},
) {
  const map = makeMap(rows);
  map.events = events;
  const world = new World({
    manifest: makeManifest({
      x: options.x ?? 0,
      y: options.y ?? 0,
      direction: options.direction ?? 'down',
    }),
    map,
    tileset,
    random: options.random ?? sequence(0.6),
  });
  const input = new ActionState();
  const tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      world.step(DT, input);
      input.endStep();
    }
  };
  const tap = () => {
    input.press('confirm');
    tick();
    input.release('confirm');
  };
  return { world, input, tick, tap };
}

const OPEN = ['.......', '.......', '.......', '.......', '.......'];

describe('event movement', () => {
  it('wanders tile by tile at its speed, pausing between steps', () => {
    // 0.6 → "right" (index 2 of down/left/right/up), and a 1.1× pause.
    const { world, tick } = setup(OPEN, [
      event('cat', 1, 2, walker({ type: 'random', speed: 2, pause: 1 })),
    ]);
    const cat = () => world.events[0];
    tick();
    expect(cat()?.mover.isMoving).toBe(true);
    expect(cat()?.x).toBe(2);
    tick(30);
    expect(cat()?.mover.isMoving).toBe(false);
    expect(cat()?.mover.realX).toBe(2);
    tick(60);
    // Still standing: 1.1 s of pause after arriving.
    expect(cat()?.x).toBe(2);
    tick(10);
    expect(cat()?.x).toBe(3);
  });

  it('never walks through walls, blocking events or the player', () => {
    const rows = ['#####', '#...#', '#####'];
    const right = sequence(0.6);
    const { world, tick } = setup(
      rows,
      [
        event('a', 2, 1, walker({ type: 'random', speed: 4, pause: 0 })),
        // A blocking event that stays put.
        event('rock', 3, 1, still()),
      ],
      { x: 1, y: 1, random: right },
    );
    tick(120);
    const a = world.events[0];
    expect(a?.x).toBe(2);
    expect(a?.direction).toBe('right');
  });

  it('walks toward the player, around obstacles', () => {
    const rows = ['.....', '.#...', '.....'];
    const { world, tick } = setup(
      rows,
      [event('dog', 3, 1, walker({ type: 'approach', speed: 4, pause: 0 }))],
      { x: 0, y: 1 },
    );
    tick(120);
    const dog = world.events[0];
    // Left is a wall at (1, 1), so it went round; it ends next to the player.
    expect(Math.abs((dog?.x ?? 0) - 0) + Math.abs((dog?.y ?? 0) - 1)).toBe(1);
  });

  it('starts its touch commands by walking into the player', () => {
    const { world, tick } = setup(
      OPEN,
      [
        event(
          'slime',
          4,
          0,
          walker(
            { type: 'approach', speed: 4, pause: 0.2 },
            { trigger: 'touch', commands: [say('Gotcha!')] },
          ),
        ),
      ],
      { x: 0, y: 0 },
    );
    tick(120);
    expect(world.interpreter?.pending).toMatchObject({ text: 'Gotcha!' });
    expect(world.interpreterEvent?.id).toBe('slime');
  });

  it('stands still while its own commands run', () => {
    const { world, tap, tick } = setup(
      OPEN,
      [event('npc', 0, 1, walker({ type: 'random', speed: 4, pause: 0 }))],
      { x: 0, y: 0, direction: 'down', random: sequence(0.9) },
    );
    // 0.9 → "up": into the player, so it can't move before we talk.
    tick();
    tap();
    expect(world.interpreter?.pending).toMatchObject({ text: 'hi' });
    const npc = world.events[0];
    expect(npc?.direction).toBe('up');
    tick(120);
    expect([npc?.x, npc?.y]).toEqual([0, 1]);
  });

  it('keeps the player out of a tile an event is leaving', () => {
    const { world, input, tick } = setup(
      OPEN,
      [event('npc', 1, 0, walker({ type: 'random', speed: 1, pause: 5 }))],
      { x: 0, y: 0, random: sequence(0.6) },
    );
    tick();
    expect(world.events[0]?.mover.isMoving).toBe(true);
    input.press('right');
    tick(10);
    expect(world.player.x).toBe(0);
    tick(60);
    expect(world.player.x).toBe(1);
  });
});
