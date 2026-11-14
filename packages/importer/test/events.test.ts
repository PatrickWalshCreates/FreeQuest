import { ActionState, DatabaseIndex, World } from '@freequest/core';
import { MemoryFs, openProject } from '@freequest/editor-core';
import { type GameMap, assembleDatabase, parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { commandTree, convertText, importMzProject, tint } from '../src/index.js';
import { TINY, codec, memoryCopy, starter } from './helpers.js';

const cmd = (code: number, indent: number, parameters: unknown[] = []) => ({
  code,
  indent,
  parameters,
});

describe('MZ command lists', () => {
  it('are read back into a tree', () => {
    const tree = commandTree([
      cmd(101, 0, ['', 0, 0, 2]),
      cmd(401, 0, ['one']),
      cmd(401, 0, ['two']),
      cmd(111, 0, [0, 1, 0]),
      cmd(112, 1),
      cmd(113, 2),
      cmd(0, 2),
      cmd(413, 1),
      cmd(0, 1),
      cmd(411, 0),
      cmd(0, 1),
      cmd(412, 0),
      cmd(230, 0, [30]),
      cmd(0, 0),
    ]);
    const shape = (nodes: ReturnType<typeof commandTree>): unknown =>
      nodes.map((n) =>
        n.kind === 'plain'
          ? [n.command.code, n.lines.length]
          : [n.command.code, n.branches.map((b) => shape([...b.body]))],
      );
    expect(shape(tree)).toEqual([
      [101, 2],
      [111, [[[112, [[[113, 0]]]]], []]],
      [230, 0],
    ]);
  });

  it('survive damage: stray markers are skipped, and deeper commands inside a block', () => {
    expect(commandTree([cmd(412, 0), cmd(230, 0, [1])]).map((n) => n.command.code)).toEqual([230]);
    const loop = commandTree([cmd(112, 0), cmd(230, 3), cmd(113, 1), cmd(0, 1), cmd(413, 0)]);
    const body = loop[0]?.kind === 'block' ? loop[0].branches[0]?.body : [];
    expect(body?.map((n) => n.command.code)).toEqual([113]);
    expect(commandTree('nope')).toEqual([]);
  });
});

describe('message text', () => {
  const ctx = {
    variable: (n: number) => `var-${n}`,
    actor: (n: number) => (n === 1 ? 'wren' : null),
    color: (n: number) => (n === 2 ? '#ff3030' : '#00ff00'),
  };
  it('turns MZ codes into FreeQuest codes', () => {
    expect(
      convertText(
        'Hi \\N[1], \\V[3] \\G! \\I[64]\\C[2]red\\C[4]green\\C[0] plain \\P[2] {x} \\\\',
        ctx,
      ),
    ).toEqual({
      text: 'Hi {actor:wren}, {v:var-3} {currency}! {icon:64}{color:#ff3030}red{/color}{color:#00ff00}green{/color} plain {member:2} {{x} \\',
      dropped: [],
    });
  });
  it('drops what FreeQuest can’t do, and closes colours left open', () => {
    expect(convertText('\\C[2]wait\\. \\! \\FS[24]big \\N[9]', ctx)).toEqual({
      text: '{color:#ff3030}wait  big {/color}',
      dropped: [
        'short pause (\\.)',
        'wait for a key (\\!)',
        '\\FS[24]',
        'the name of missing actor 9 (\\N[9])',
      ],
    });
  });
});

describe('screen tints', () => {
  it('lean the tone’s way, stronger for bigger tones', () => {
    expect(tint([0, 0, 0, 0])).toEqual({ color: '#808080', strength: 0 });
    expect(tint([-68, -68, 0, 68])).toEqual({ color: '#5e5e80', strength: 0.4 });
    expect(tint([255, 0, 0, 0])).toEqual({ color: '#ff8080', strength: 1 });
  });
});

async function imported() {
  const target = new MemoryFs();
  const result = await importMzProject(await memoryCopy(TINY), target, {
    template: await starter(),
    images: codec,
  });
  const map = JSON.parse(await target.readText('data/maps/hollow.json')) as GameMap;
  const messages = (where: string) =>
    result.report.items.filter((i) => i.where === where).map((i) => i.message);
  return { target, result, map, messages };
}

describe('importing events', () => {
  it('converts pages: conditions, graphics, triggers, layers and movement', async () => {
    const { map, target } = await imported();
    expect(map.events.map((e) => [e.id, e.name, e.x, e.y])).toEqual([
      ['keeper', 'Keeper', 1, 2],
      ['gate', 'Gate', 3, 1],
    ]);
    const [first, second] = map.events[0]?.pages ?? [];
    expect(first).toMatchObject({
      conditions: [],
      graphic: { character: 'lamplighters-2', direction: 'left' },
      trigger: 'action',
      layer: 'same',
    });
    expect(second).toMatchObject({
      conditions: [{ type: 'flag', flag: 'a', value: true }],
      graphic: { character: 'hollow-tile-3', direction: 'down' },
      commands: [
        {
          type: 'moveRoute',
          target: 'this',
          steps: [
            { type: 'move', direction: 'up' },
            { type: 'wait', seconds: 0.5 },
          ],
          repeat: false,
          skipBlocked: true,
          wait: true,
        },
        { type: 'hideEvent', hidden: true },
      ],
    });
    expect(map.events[1]?.pages[0]).toMatchObject({
      graphic: { character: 'tamsin', direction: 'up', fixed: true },
      trigger: 'touch',
      layer: 'below',
      movement: { type: 'random', speed: 4, pause: 0.5 },
    });
    expect(await target.readText('data/characters/hollow-tile-3.json')).toContain('"frames": 1');
  });

  it('converts commands into a tree, keeping the rest as comments', async () => {
    const { map } = await imported();
    const commands = map.events[0]?.pages[0]?.commands ?? [];
    expect(commands.map((c) => c.type)).toEqual([
      'message',
      'choice',
      'if',
      'if',
      'loop',
      'transfer',
      'battle',
      'shop',
      'playSound',
      'comment',
      'callCommon',
    ]);
    expect(commands[0]).toEqual({
      type: 'message',
      speaker: 'Keeper',
      face: { image: 'assets/faces/lamplighters_face.png', index: 2 },
      text: 'Hello {actor:wren}! You lit {v:lanterns-lit} lanterns.\n{color:#ff3030}Careful{/color} out there {{friend}.',
    });
    expect(commands[1]).toEqual({
      type: 'choice',
      options: [
        {
          label: 'Yes',
          commands: [
            { type: 'setSwitch', switch: 'met-the-keeper', value: true },
            { type: 'setFlag', flag: 'a', value: true },
          ],
        },
        { label: 'No', commands: [] },
      ],
      cancel: 1,
    });
    expect(commands[2]).toEqual({
      type: 'if',
      conditions: [{ type: 'switch', switch: 'met-the-keeper', value: true }],
      then: [{ type: 'changeGold', amount: 50 }],
      else: [{ type: 'comment', text: 'From MZ, not imported: Script: console.log(1)' }],
    });
    // A script test: the switch that's never on, both branches kept.
    expect(commands[3]).toEqual({
      type: 'if',
      conditions: [{ type: 'switch', switch: 'imported-condition-to-redo', value: true }],
      then: [{ type: 'wait', seconds: 1 }],
    });
    expect(commands[4]).toEqual({
      type: 'loop',
      commands: [
        { type: 'setVariable', variable: 'lanterns-lit', op: 'add', value: 2 },
        { type: 'break' },
      ],
    });
    expect(commands[5]).toEqual({ type: 'transfer', map: 'hollow', x: 3, y: 2, direction: 'up' });
    expect(commands[6]).toEqual({
      type: 'battle',
      troop: 'shade',
      canEscape: true,
      canLose: false,
      onWin: [{ type: 'message', text: 'Well fought.' }],
      onEscape: [],
    });
    expect(commands[7]).toEqual({
      type: 'shop',
      goods: [
        { kind: 'item', id: 'lamp-oil', price: 30 },
        { kind: 'equipment', id: 'old-sword' },
      ],
      canSell: true,
    });
    expect(commands[8]).toEqual({ type: 'playSound', path: 'assets/audio/se/chime.ogg' });
    expect(commands[9]).toEqual({ type: 'comment', text: 'From MZ, not imported: Show balloon' });
    expect(commands[10]).toEqual({ type: 'callCommon', common: 'open-gate' });
  });

  it('reports what each list left out, once', async () => {
    const { messages } = await imported();
    expect(messages('Maps › Hollow › Keeper')).toEqual([
      "Commands FreeQuest doesn't have, kept as comments: Script, Show balloon.",
      "1 branch tests something FreeQuest can't; it now tests the switch “Imported: condition to redo”, which is never on.",
      'Text codes left out: short pause (\\.).',
      "Move route steps FreeQuest doesn't have were left out: jump.",
    ]);
  });

  it('converts common events, and the project opens with no problems', async () => {
    const { target } = await imported();
    const project = await openProject(target);
    expect(project.problems).toEqual([]);
    const common = JSON.parse(await target.readText('data/database/commonEvents.json')) as {
      entries: unknown[];
    };
    expect(common.entries).toEqual([
      {
        id: 'open-gate',
        name: 'Open gate',
        trigger: 'call',
        commands: [{ type: 'setSwitch', switch: 'gate-open', value: true }],
      },
      {
        id: 'night',
        name: 'Night',
        trigger: 'parallel',
        switch: 'gate-open',
        commands: [{ type: 'tintScreen', color: '#5e5e80', strength: 0.4, seconds: 1, wait: true }],
      },
    ]);
    expect(target.binaries.has('assets/audio/se/chime.ogg')).toBe(true);
  });
});

describe('an imported game', () => {
  it('plays: talking to the keeper runs the converted commands in the engine', async () => {
    const { target } = await imported();
    const read = async (path: string) => JSON.parse(await target.readText(path)) as unknown;
    const kinds = [
      'system',
      'actors',
      'classes',
      'skills',
      'items',
      'equipment',
      'states',
      'enemies',
      'troops',
      'commonEvents',
    ] as const;
    const files = Object.fromEntries(
      await Promise.all(
        kinds.map(async (k) => [k, parseProjectFile(k, await read(`data/database/${k}.json`))]),
      ),
    );
    const world = new World({
      manifest: parseProjectFile('manifest', await read('project.json')),
      map: parseProjectFile('map', await read('data/maps/hollow.json')),
      tileset: parseProjectFile('tileset', await read('data/tilesets/hollow.json')),
      database: new DatabaseIndex(assembleDatabase(files)),
      random: () => 0.5,
    });
    const input = new ActionState();
    const step = () => {
      world.step(1 / 60, input);
      input.endStep();
    };
    // The player starts at (3, 2); the keeper stands at (1, 2). Walk left one tile, then talk.
    input.press('left');
    for (let i = 0; i < 60 && world.player.x !== 2; i++) step();
    input.release('left');
    while (world.player.isMoving) step();
    input.press('confirm');
    step();
    input.release('confirm');
    const seen: string[] = [];
    for (let i = 0; i < 2000 && world.interpreter; i++) {
      const interpreter = world.interpreter;
      const request = interpreter.pending;
      if (!request) {
        step();
        continue;
      }
      seen.push(request.type);
      if (request.type === 'choice') interpreter.choose(0);
      else if (request.type === 'battle') interpreter.finishBattle('win');
      else if (request.type === 'transfer') {
        world.changeMap(
          world.map,
          world.tileset,
          request.x,
          request.y,
          request.direction ?? undefined,
        );
        interpreter.continue();
      } else interpreter.continue();
      step();
    }
    expect(seen).toEqual(['message', 'choice', 'transfer', 'battle', 'message', 'shop']);
    expect(world.state.getSwitch('met-the-keeper')).toBe(true);
    expect(world.state.getSwitch('gate-open')).toBe(true); // the common event ran
    expect(world.state.getVariable('lanterns-lit')).toBe(2);
    expect(world.party.gold).toBe(50);
    expect(world.state.getFlag('hollow', 'keeper', 'a')).toBe(true);
  });
});

describe('music and sounds', () => {
  it('bring the game’s own music, sounds and map music, and leave the template’s out', async () => {
    const { target, map, result } = await imported();
    expect(map.music).toBe('assets/audio/bgm/hollow.ogg');
    const system = JSON.parse(await target.readText('data/database/system.json')) as {
      audio: unknown;
    };
    expect(system.audio).toEqual({
      titleMusic: 'assets/audio/bgm/title.ogg',
      sounds: { cursor: 'assets/audio/se/cursor.ogg', confirm: 'assets/audio/se/cursor.ogg' },
    });
    expect([...target.binaries.keys()].filter((p) => p.startsWith('assets/audio/')).sort()).toEqual(
      [
        'assets/audio/bgm/hollow.ogg',
        'assets/audio/bgm/title.ogg',
        'assets/audio/se/chime.ogg',
        'assets/audio/se/cursor.ogg',
      ],
    );
    const where = (w: string) =>
      result.report.items.filter((i) => i.where === w).map((i) => i.message);
    expect(where('System sounds')).toEqual([
      "audio/bgm/Fight.ogg is missing, so it's silent.",
      "audio/me/Victory.ogg is missing; there's only an .m4a, which FreeQuest doesn't play. Convert it to .ogg and add it in the editor's Assets.",
    ]);
    expect(where('Maps › Hollow')).toContain(
      'Its background sound (BGS) isn’t played; FreeQuest maps have music only.',
    );
    expect((await openProject(target)).problems).toEqual([]);
  });
});
