// End-to-end: plays the demo project's quest through real movement,
// triggers, conditionals, switches and variables, the way a player would.
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawHouse from '../../../samples/demo-project/data/maps/house.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import { demoDb } from './demo-db.js';
import {
  ActionState,
  Battle,
  type BattleOutcome,
  type Direction,
  World,
  buy,
} from '../src/index.js';

/** Small seeded PRNG (mulberry32) so battles in this script are reproducible. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DT = 1 / 60;

function play() {
  const world = new World({
    manifest: parseProjectFile('manifest', rawManifest),
    map: parseProjectFile('map', rawMap),
    tileset: parseProjectFile('tileset', rawTileset),
    database: demoDb(),
    random: () => 0.5,
  });
  const input = new ActionState();
  /** Battles fought, with their outcomes. */
  const battles: { troop: string; outcome: BattleOutcome }[] = [];
  /** Every line of dialogue shown, in order. */
  const transcript: string[] = [];
  let lastRequest: unknown = null;

  const step = () => {
    world.step(DT, input);
    input.endStep();
    // Random encounters are covered by their own tests; skip them here.
    if (world.hasPendingEncounter) world.takeEncounter();
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

  /** What battle events said, and the skills used, in fights. */
  const battleTalk: string[] = [];
  const skillsUsed: string[] = [];

  /**
   * Fight with the real battle engine: everyone attacks the first enemy
   * standing, with Brave Strike once there's TP for it. Battle events that come
   * due have their messages noted (the battle screen would show them).
   */
  const fight = (troop: string, canEscape: boolean): BattleOutcome => {
    const battle = new Battle({
      db: world.db,
      party: world.party,
      troop,
      state: world.state,
      canEscape,
      random: seeded(42),
    });
    for (let turn = 0; turn < 100 && battle.phase === 'input'; turn++) {
      for (const commands of battle.dueEvents('turnStart')) {
        for (const c of commands) if (c.type === 'message') battleTalk.push(c.text);
      }
      for (const actor of battle.actorsToCommand()) {
        const target = battle.livingEnemies[0];
        const brave = {
          kind: 'skill' as const,
          skill: 'brave-strike',
          ...(target ? { target } : {}),
        };
        const skill = battle.actionProblem(actor, brave) === null ? 'brave-strike' : 'attack';
        skillsUsed.push(skill);
        battle.setAction(actor, { kind: 'skill', skill, ...(target ? { target } : {}) });
      }
      battle.runTurn();
    }
    return battle.phase === 'won' ? 'win' : battle.phase === 'escaped' ? 'escape' : 'lose';
  };

  /** Answer the pending request the way the dialog UI, transfers and battles would. */
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
    } else if (request.type === 'battle') {
      const outcome = fight(request.troop, request.canEscape);
      battles.push({ troop: request.troop, outcome });
      interpreter.finishBattle(outcome);
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

  return { world, transcript, battles, battleTalk, skillsUsed, walkTo, tap, answer, finish };
}

describe('demo quest', () => {
  it('can be completed from start to finish', () => {
    const { world, transcript, battles, battleTalk, walkTo, tap, finish } = play();
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
    // He hands over his map, to read from the menu.
    expect(world.party.count('item', 'meadow-map')).toBe(1);

    // Walk to the bridge: the touch event fires on arrival at (15, 5).
    walkTo('up', 11, 5);
    walkTo('right', 17, 5);
    expect(world.interpreterEvent?.id).toBe('bridge');
    expect([world.player.x, world.player.y]).toEqual([15, 5]);
    finish();
    expect(visits()).toBe(1);
    // The wolf ambush: fought and won at level 1.
    expect(battles).toEqual([{ troop: 'bridge-wolf', outcome: 'win' }]);
    // Its battle event: the wolf circles on turn 1.
    expect(battleTalk).toEqual(['The wolf bares its teeth and circles you.']);
    expect(world.state.getSwitch('wolf_defeated')).toBe(true);

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
    // 50 starting gold + 18 from the wolf; potions may have dropped too.
    const potions = world.party.count('item', 'potion');
    expect(world.party.gold).toBe(68);
    tap('confirm');
    finish();
    expect([world.party.gold, world.party.count('item', 'potion')]).toEqual([168, potions + 2]);
    tap('confirm');
    finish();
    expect([world.party.gold, world.party.count('item', 'potion')]).toEqual([168, potions + 2]);

    expect(transcript).toEqual([
      'Elder: Ah, a traveler! Would you check on the old bridge to the east?',
      'Elder: Thank you. Follow the path east.',
      'Elder: Take my old map, so you don’t lose your way.',
      'Received the Elder’s Map. Read it from the menu (Items).',
      'The planks creak, but the bridge holds.',
      'A wolf leaps out from under the bridge!',
      'The wolf limps away. The bridge is safe again.',
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
    expect(transcript).toContain('Elder: Thank you. Follow the path east.');
    expect(transcript.at(-1)).toBe('Received the Elder’s Map. Read it from the menu (Items).');
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
    // The map's choice loops: look closer twice, then step back.
    finish(1, 1, 0);
    // The chest in the corner gives a potion once, then remembers it was opened.
    const potions = world.party.count('item', 'potion');
    walkTo('left', 1, 1); // blocked by the chest: only turns
    tap('confirm');
    finish();
    tap('confirm');
    finish();
    expect(world.party.count('item', 'potion')).toBe(potions + 1);
    expect(world.state.getFlag('house', 'chest', 'opened')).toBe(true);
    // Mira stands below; talking to her adds her to the party and she steps aside.
    walkTo('down', 2, 3); // stops at (2, 2): Mira blocks
    expect(world.party.hasMember('mira')).toBe(false);
    tap('confirm');
    finish();
    expect(world.party.members.map((m) => m.id)).toEqual(['hero', 'mira']);
    expect(transcript).toEqual([
      'The hearth is cold.',
      'A hand-drawn map of the Meadow. The bridge is circled twice.',
      'In one corner, in tiny letters: Hero was here.',
      'In one corner, in tiny letters: Hero was here.',
      'You open the chest. Inside: a Potion!',
      'The chest is empty.',
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

  it('reads the elder’s map: its picture fades in for the message, then goes', () => {
    const { world, finish } = play();
    // What using the map from the menu does: its common event runs on the map.
    world.run([{ type: 'callCommon', common: 'read-map' }]);
    for (let i = 0; i < 60 && world.interpreter?.pending?.type !== 'message'; i++) {
      world.step(1 / 60, new ActionState());
    }
    expect(world.pictures.list).toMatchObject([
      { number: 1, image: 'assets/pictures/meadow-map.png', opacity: 1 },
    ]);
    expect(world.interpreter?.pending).toMatchObject({
      type: 'message',
      text: 'The elder’s map: the old bridge is east, past the stream.',
    });
    finish();
    expect(world.pictures.list).toEqual([]);
  });

  it('builds TP by attacking and spends it on Brave Strike', () => {
    const { world, skillsUsed, answer } = play();
    world.run([{ type: 'battle', troop: 'bats', canEscape: true, canLose: true }]);
    world.step(1 / 60, new ActionState());
    answer();
    // Attacks give 10 TP each and taking hits gives more: Brave Strike (20 TP) by turn 3.
    expect(skillsUsed.slice(0, 2)).toEqual(['attack', 'attack']);
    expect(skillsUsed).toContain('brave-strike');
  });

  it('buys a potion from the peddler', () => {
    const { world, transcript, walkTo, tap, answer, finish } = play();
    walkTo('down', 7, 12);
    walkTo('left', 2, 12); // stops at (3, 12): the peddler's stall
    expect([world.player.x, world.player.y]).toEqual([3, 12]);
    tap('confirm');
    expect(world.interpreterEvent?.id).toBe('peddler');
    answer(); // the greeting
    const request = world.interpreter?.pending;
    if (request?.type !== 'shop') throw new Error(`expected the shop, got ${request?.type}`);
    const potion = request.goods.find((g) => g.id === 'potion');
    if (!potion) throw new Error('no potions for sale');
    // What the shop screen does when the player buys one.
    buy(world.party, world.db, potion, 1);
    finish();
    expect(world.party.gold).toBe(0);
    expect(world.party.count('item', 'potion')).toBe(1);
    expect(transcript.at(-1)).toBe('Peddler: Safe travels, friend.');
  });
});
