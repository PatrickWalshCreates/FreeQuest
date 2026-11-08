// End-to-end: plays the demo project's quest through real movement,
// triggers, conditionals, switches and variables, the way a player would.
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawHouse from '../../../samples/demo-project/data/maps/house.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { demoDb } from './demo-db.js';
import { ActionState, type Direction, World } from '../src/index.js';

const DT = 1 / 60;

function play() {
  const world = new World({
    manifest: parseProjectFile('manifest', rawManifest),
    map: parseProjectFile('map', rawMap),
    tileset: parseProjectFile('tileset', rawTileset),
    database: demoDb(),
  });
  const input = new ActionState();
  /** Every line of dialogue shown, in order. */
  const transcript: string[] = [];
  let lastRequest: unknown = null;

  const step = () => {
    world.step(DT, input);
    input.endStep();
    const request = world.interpreter?.pending ?? null;
    if (request && request !== lastRequest && request.type === 'message') {
      transcript.push(request.speaker ? `${request.speaker}: ${request.text}` : request.text);
    }
    lastRequest = request;
  };

  /** Hold `dir` until the player is headed for (tx, ty), or an event starts. */
  const walkTo = (dir: Direction, tx: number, ty: number) => {
    if (world.player.x === tx && world.player.y === ty) return;
    input.press(dir);
    for (let i = 0; i < 600; i++) {
      step();
      if (world.interpreter) break;
      if (world.player.x === tx && world.player.y === ty) break;
    }
    input.release(dir);
    while (world.player.isMoving && !world.interpreter) step();
  };

  const tap = (action: 'confirm') => {
    input.press(action);
    step();
    input.release(action);
    step();
  };

  const maps = new Map([
    ['map001', parseProjectFile('map', rawMap)],
    ['house', parseProjectFile('map', rawHouse)],
  ]);

  /** Answer the pending request the way the dialog UI and transfer controller would. */
  const answer = (choice?: number) => {
    const interpreter = world.interpreter;
    const request = interpreter?.pending;
    if (!interpreter || !request) throw new Error('nothing to answer');
    if (request.type === 'choice') interpreter.choose(choice ?? 0);
    else if (request.type === 'transfer') {
      const target = maps.get(request.map);
      if (!target) throw new Error(`unknown map ${request.map}`);
      world.changeMap(target, world.tileset, request.x, request.y, request.direction ?? undefined);
      interpreter.continue();
    } else interpreter.continue();
    step();
  };

  /** Answer requests until the running event ends. */
  const finish = (...choices: number[]) => {
    while (world.interpreter) {
      const request = world.interpreter.pending;
      if (request?.type === 'choice') answer(choices.shift());
      else if (request) answer();
      else step();
    }
  };

  return { world, transcript, walkTo, tap, finish };
}

describe('demo quest', () => {
  it('can be completed from start to finish', () => {
    const { world, transcript, walkTo, tap, finish } = play();
    const visits = () => world.state.getVariable('bridge_visits');

    // Crossing the bridge before accepting the request does nothing:
    // the bridge event's page requires the switch.
    walkTo('down', 7, 8);
    walkTo('right', 12, 8); // stops at (11, 8): the elder blocks the way
    expect([world.player.x, world.player.y]).toEqual([11, 8]);
    expect(world.interpreter).toBeNull();

    // Talk to the elder and accept.
    tap('confirm');
    expect(world.interpreterEvent?.id).toBe('elder');
    finish(0);
    expect(world.state.getSwitch('accepted_request')).toBe(true);

    // Walk to the bridge: the touch event fires on arrival at (15, 5).
    walkTo('up', 11, 5);
    walkTo('right', 17, 5);
    expect(world.interpreterEvent?.id).toBe('bridge');
    expect([world.player.x, world.player.y]).toEqual([15, 5]);
    finish();
    expect(visits()).toBe(1);

    // Cross back over it: counted again, but the `== 1` check keeps quiet
    // (the event has nothing to show, so it ends within the step).
    walkTo('right', 17, 5);
    const linesBefore = transcript.length;
    walkTo('left', 11, 5);
    expect([world.player.x, world.player.y]).toEqual([11, 5]);
    expect(visits()).toBe(2);
    expect(transcript.length).toBe(linesBefore);

    // Back to the elder: his second page rewards the visit, once.
    walkTo('down', 11, 8);
    walkTo('right', 12, 8);
    expect([world.party.gold, world.party.count('item', 'potion')]).toEqual([50, 0]);
    tap('confirm');
    finish();
    expect([world.party.gold, world.party.count('item', 'potion')]).toEqual([150, 2]);
    tap('confirm');
    finish();
    expect([world.party.gold, world.party.count('item', 'potion')]).toEqual([150, 2]);

    expect(transcript).toEqual([
      'Elder: Ah, a traveler! Would you check on the old bridge to the east?',
      'Elder: Thank you. Follow the path east.',
      'The planks creak, but the bridge holds.',
      'Elder: You saw the bridge? Good, it still stands. Take these for your trouble.',
      'Received 2 Potions and 100 G.',
      'Elder: Safe travels, friend.',
    ]);
  });

  it('remembers a declined request and lets the player accept later', () => {
    const { world, transcript, walkTo, tap, finish } = play();
    walkTo('down', 7, 8);
    walkTo('right', 12, 8);
    tap('confirm');
    finish(1); // "Not now"
    expect(world.state.getSwitch('accepted_request')).toBe(false);
    tap('confirm');
    finish(0);
    expect(world.state.getSwitch('accepted_request')).toBe(true);
    expect(transcript).toContain('Elder: Come back if you change your mind.');
    expect(transcript.at(-1)).toBe('Elder: Thank you. Follow the path east.');
  });

  it("gives the elder's else branch before the bridge is visited", () => {
    const { world, transcript, walkTo, tap, finish } = play();
    world.state.setSwitch('accepted_request', true);
    walkTo('down', 7, 8);
    walkTo('right', 12, 8);
    tap('confirm');
    finish();
    expect(transcript).toEqual(['Elder: The bridge is east along the path.']);
  });

  it('goes into the house through the door and back out', () => {
    const { world, transcript, walkTo, tap, finish } = play();
    // The door is at (4, 4), up from the path at (4, 5).
    walkTo('up', 7, 5);
    walkTo('left', 4, 5);
    walkTo('up', 4, 4);
    finish();
    expect(world.map.id).toBe('house');
    expect([world.player.x, world.player.y, world.player.direction]).toEqual([4, 5, 'up']);

    // Look at the hearth, then the map on the wall.
    walkTo('right', 7, 5);
    walkTo('up', 7, 2);
    tap('confirm');
    finish();
    walkTo('left', 2, 2);
    walkTo('up', 2, 1);
    tap('confirm');
    finish();
    // Mira stands below; talking to her adds her to the party and she steps aside.
    walkTo('down', 2, 3); // stops at (2, 2): Mira blocks
    expect(world.party.hasMember('mira')).toBe(false);
    tap('confirm');
    finish();
    expect(world.party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
    expect(transcript).toEqual([
      'The hearth is cold.',
      'A hand-drawn map of the Meadow. The bridge is circled twice.',
      "Mira: Grandfather sent you to check the bridge? Then I'm coming too.",
      'Mira joined the party!',
    ]);

    // Leave through the gap in the bottom wall (Mira no longer blocks).
    walkTo('down', 2, 5);
    walkTo('right', 4, 5);
    walkTo('down', 4, 6);
    finish();
    expect(world.map.id).toBe('map001');
    expect([world.player.x, world.player.y, world.player.direction]).toEqual([4, 5, 'down']);
  });

  it('rests by the hearth once the request is accepted', () => {
    const { world, transcript, walkTo, tap, finish } = play();
    world.state.setSwitch('accepted_request', true);
    const hero = world.party.member('hero');
    if (!hero) throw new Error('no hero');
    hero.setHp(5);
    hero.addState('poison');
    walkTo('up', 7, 5);
    walkTo('left', 4, 5);
    walkTo('up', 4, 4);
    finish();
    walkTo('right', 7, 5);
    walkTo('up', 7, 2);
    tap('confirm');
    finish();
    expect(hero.hp).toBe(hero.maxHp);
    expect(hero.states).toEqual([]);
    expect(transcript.at(-1)).toBe('Everyone is fully rested.');
  });
});
