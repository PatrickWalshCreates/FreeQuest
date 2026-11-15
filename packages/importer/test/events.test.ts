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
  it('turns pauses, waits for a key and instant text into pacing codes', () => {
    expect(convertText('a\\.b\\|c\\!d\\>fast\\<e', ctx)).toEqual({
      text: 'a{wait:0.25}b{wait:1}c{key}d{instant}fast{/instant}e',
      dropped: [],
    });
  });

  it('drops what FreeQuest can’t do, and closes colours left open', () => {
    expect(convertText('\\C[2]wait\\^ \\$ \\FS[24]big \\N[9]', ctx)).toEqual({
      text: '{color:#ff3030}wait  big {/color}',
      dropped: [
        'no wait at the end (\\^)',
        'gold window (\\$)',
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
      ['stagehand', 'Stagehand', 2, 2],
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
            { type: 'jump', x: 0, y: 0 },
            { type: 'wait', seconds: 0.5 },
            // No image hides it; an image shows it again, looking like that.
            { type: 'hidden', on: true },
            { type: 'character', character: 'lamplighters-2' },
            { type: 'hidden', on: false },
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
      'showBalloon',
      'callCommon',
      'changeActor',
      'changeActor',
      'hidePlayer',
    ]);
    expect(commands[0]).toEqual({
      type: 'message',
      speaker: 'Keeper',
      face: { image: 'assets/faces/lamplighters_face.png', index: 2 },
      text: 'Hello {actor:wren}! You lit {v:lanterns-lit} lanterns.\n{color:#ff3030}Careful{/color} {wait:0.25}out there {{friend}.',
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
    expect(commands[9]).toEqual({ type: 'showBalloon', target: 'player', balloon: 0, wait: false });
    expect(commands[10]).toEqual({ type: 'callCommon', common: 'open-gate' });
    expect(commands.slice(11)).toEqual([
      { type: 'changeActor', actor: 'tamsin', character: 'lamplighters-4' },
      { type: 'changeActor', actor: 'wren', name: 'Wren the Bright' },
      { type: 'hidePlayer', hidden: true },
    ]);
  });

  it('converts game data, branch tests, placing, scrolling, audio, access and HP', async () => {
    const { map, messages } = await imported();
    const commands = map.events[2]?.pages[0]?.commands ?? [];
    const set = (value: unknown, op = 'set') => ({
      type: 'setVariable',
      variable: 'lanterns-lit',
      op,
      value,
    });
    const test = (condition: unknown) => ({ type: 'if', conditions: [condition], then: [] });
    expect(commands).toEqual([
      set({ random: { min: 1, max: 6 } }),
      set({ game: { type: 'gold' } }),
      set({ game: { type: 'actorStat', actor: 'wren', stat: 'hp' } }, 'add'),
      set({ game: { type: 'position', target: 'player', axis: 'x' } }),
      {
        type: 'comment',
        text: 'From MZ, not imported: Control variables (script or game data): a script',
      },
      test({ type: 'actorState', actor: 'wren', state: 'bracing', value: true }),
      test({ type: 'actorName', actor: 'tamsin', name: 'Tam' }),
      test({ type: 'facing', target: 'player', direction: 'up' }),
      test({ type: 'held', action: 'confirm' }),
      test({ type: 'switch', switch: 'imported-condition-to-redo', value: true }),
      { type: 'placeEvent', x: 2, y: 1, direction: 'left' },
      {
        type: 'placeEvent',
        event: 'keeper',
        x: { variable: 'lanterns-lit' },
        y: { variable: 'lanterns-lit' },
      },
      { type: 'scrollMap', direction: 'right', tiles: 3, speed: 4, wait: true },
      { type: 'playBackgroundSound', path: 'assets/audio/bgs/wind.ogg' },
      { type: 'playBackgroundSound', path: null },
      { type: 'changeBattleMusic', which: 'battle', path: 'assets/audio/bgm/hollow.ogg' },
      { type: 'comment', text: 'From MZ, not imported: Change victory music: silence' },
      { type: 'setAccess', what: 'saving', allowed: false },
      { type: 'setAccess', what: 'menu', allowed: true },
      { type: 'changeHp', amount: -10, canKnockOut: false },
      { type: 'changeMp', actor: 'wren', amount: 5 },
      { type: 'changeState', actor: 'wren', action: 'add', state: 'bracing' },
      {
        type: 'showPicture',
        number: 1,
        image: 'assets/pictures/sky.png',
        origin: 'center',
        x: 10,
        y: 20,
        scaleX: 100,
        scaleY: 50,
        opacity: 0.502,
      },
      {
        type: 'movePicture',
        number: 1,
        origin: 'top-left',
        x: 30,
        y: 40,
        scaleX: 100,
        scaleY: 100,
        opacity: 1,
        seconds: 1,
        easing: 'ease-out',
        wait: true,
      },
      { type: 'comment', text: 'From MZ, not imported: Rotate picture' },
      { type: 'erasePicture', number: 1 },
      { type: 'erasePicture', number: 2 },
      { type: 'showAnimation', target: 'player', animation: 'lantern-glow', wait: true },
      { type: 'showBalloon', target: 'this', balloon: 3, wait: false },
      { type: 'openSave' },
      { type: 'gameOver' },
      { type: 'returnToTitle' },
    ]);
    expect(messages('Maps › Hollow › Stagehand')).toEqual([
      "Commands FreeQuest doesn't have, kept as comments: Control variables (script or game data), Change victory music, Rotate picture.",
      "1 branch tests something FreeQuest can't; it now tests the switch “Imported: condition to redo”, which is never on.",
    ]);
  });

  it('reports what each list left out, once', async () => {
    const { messages } = await imported();
    expect(messages('Maps › Hollow › Keeper')).toEqual([
      "Commands FreeQuest doesn't have, kept as comments: Script.",
      "1 branch tests something FreeQuest can't; it now tests the switch “Imported: condition to redo”, which is never on.",
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

describe('animations and balloons', () => {
  it('makes stand-ins for the animations used, with their length and sounds, and the balloon image', async () => {
    const { target, result } = await imported();
    const animations = JSON.parse(await target.readText('data/database/animations.json')) as {
      entries: { id: string; frames: number; fps: number; sounds: unknown[]; image?: string }[];
    };
    // "Never used" isn't brought across.
    expect(animations.entries.map((a) => a.id)).toEqual(['lantern-glow', 'cut']);
    expect(animations.entries[0]).toMatchObject({
      frames: 21,
      fps: 30,
      sounds: [{ frame: 15, path: 'assets/audio/se/chime.ogg' }],
    });
    expect(animations.entries[0]?.image).toBeUndefined();
    // "Cut" runs at twice MZ's speed and times nothing: the shortest stand-in.
    expect(animations.entries[1]).toMatchObject({ frames: 15, sounds: [] });
    const skills = JSON.parse(await target.readText('data/database/skills.json')) as {
      entries: { id: string; animation?: string }[];
    };
    // Strike's own, and Ember's "normal attack" (Strike's too).
    expect(skills.entries.filter((s) => s.animation).map((s) => [s.id, s.animation])).toEqual([
      ['strike', 'cut'],
      ['ember', 'cut'],
    ]);
    const system = JSON.parse(await target.readText('data/database/system.json')) as {
      balloons?: { image: string; size: number; frames: number; names: string[] };
    };
    expect(system.balloons).toMatchObject({
      image: 'assets/system/balloons.png',
      size: 48,
      frames: 8,
    });
    expect(system.balloons?.names).toHaveLength(15);
    expect(target.binaries.has('assets/system/balloons.png')).toBe(true);
    // The Starter's own animation images aren't copied.
    expect([...target.binaries.keys()].some((p) => p.startsWith('assets/animations/'))).toBe(false);
    const messages = result.report.items
      .filter((i) => i.where === 'Animations')
      .map((i) => i.message);
    expect(messages).toEqual([
      "2 animations are stand-ins: MZ's are Effekseer effects, which FreeQuest can't play. Each keeps its name, length and sounds; give it frames in Database › Animations.",
      "1 of them flashed the screen or the target; the stand-ins don't.",
    ]);
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
        'assets/audio/bgs/wind.ogg',
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
    expect(map.backgroundSound).toBe('assets/audio/bgs/wind.ogg');
    expect((await openProject(target)).problems).toEqual([]);
  });
});
