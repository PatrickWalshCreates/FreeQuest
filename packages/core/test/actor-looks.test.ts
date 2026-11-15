// Who the player looks like: the party leader's character, changed names and
// characters (changeActor), and hiding the player (hidePlayer), all saved.
import { parseProjectFile } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import rawManifest from '../../../samples/demo-project/project.json' with { type: 'json' };
import rawMap from '../../../samples/demo-project/data/maps/map001.json' with { type: 'json' };
import rawTileset from '../../../samples/demo-project/data/tilesets/overworld.json' with { type: 'json' };
import {
  ActionState,
  GameState,
  Interpreter,
  Party,
  World,
  expandPlainText,
} from '../src/index.js';
import { demoDb } from './demo-db.js';

const manifest = parseProjectFile('manifest', rawManifest);
const map = parseProjectFile('map', rawMap);
const tileset = parseProjectFile('tileset', rawTileset);

function world(overrides: Partial<typeof manifest> = {}) {
  return new World({ manifest: { ...manifest, ...overrides }, map, tileset, database: demoDb() });
}

/** Step the world until no event runs, answering whatever it asks. */
function settle(w: World) {
  const input = new ActionState();
  for (let i = 0; i < 2000 && w.interpreter; i++) {
    const request = w.interpreter.pending;
    if (request?.type === 'choice') w.interpreter.choose(0);
    else if (request) w.interpreter.continue();
    w.step(1 / 60, input);
  }
}

/** Run commands as an event of `w` would (through the world's own context). */
function run(w: World, commands: Parameters<World['run']>[0]) {
  settle(w);
  w.run(commands);
  settle(w);
}

describe('changeActor', () => {
  it('renames and re-dresses an actor, in or out of the party', () => {
    const party = Party.start(demoDb(), { party: ['hero'], gold: 0 });
    const state = new GameState(manifest);
    const before = party.version;
    new Interpreter(
      [
        { type: 'changeActor', actor: 'hero', name: 'Ash', character: 'villager' },
        { type: 'changeActor', actor: 'mira', name: 'Mira the Bold' },
      ],
      { state, party },
    ).update(1 / 60);
    expect(party.members[0]).toMatchObject({ name: 'Ash', character: 'villager' });
    expect(party.version).toBeGreaterThan(before);
    // Mira isn't a member yet: she keeps the new name when she joins.
    expect(party.actorName('mira')).toBe('Mira the Bold');
    party.addMember('mira');
    expect(party.member('mira')?.name).toBe('Mira the Bold');
    expect(expandPlainText('{actor:hero} and {actor:mira}', { state, party })).toBe(
      'Ash and Mira the Bold',
    );
  });

  it('throws for an actor the database doesn’t have', () => {
    const party = Party.start(demoDb(), { party: [], gold: 0 });
    expect(() => party.changeActor('nobody', { name: 'X' })).toThrow();
  });
});

describe('the player', () => {
  it('looks like the party leader, or the project’s player character with no party', () => {
    const w = world();
    expect(w.playerCharacter).toBe('hero');
    run(w, [{ type: 'changeActor', actor: 'hero', character: 'villager' }]);
    expect(w.playerCharacter).toBe('villager');
    run(w, [{ type: 'changeParty', action: 'remove', actor: 'hero' }]);
    expect(w.playerCharacter).toBe(manifest.player.character);
  });

  it('can be hidden from the start and shown by an event', () => {
    const w = world({ player: { ...manifest.player, hidden: true } });
    expect(w.playerHidden).toBe(true);
    run(w, [{ type: 'hidePlayer', hidden: false }]);
    expect(w.playerHidden).toBe(false);
    run(w, [{ type: 'hidePlayer', hidden: true }]);
    expect(w.playerHidden).toBe(true);
  });

  it('keeps changed looks and being hidden in saves', () => {
    const w = world();
    run(w, [
      { type: 'changeActor', actor: 'hero', name: 'Ash', character: 'villager' },
      { type: 'hidePlayer', hidden: true },
    ]);
    settle(w);
    const save = w.toSave({ game: 'demo', playSeconds: 1 });
    expect(save.playerHidden).toBe(true);
    expect(save.party.looks).toEqual({ hero: { name: 'Ash', character: 'villager' } });
    expect(save.summary.members[0]?.name).toBe('Ash');
    const back = World.fromSave(parseProjectFile('save', JSON.parse(JSON.stringify(save))), {
      manifest,
      map,
      tileset,
      database: demoDb(),
    });
    expect(back.playerHidden).toBe(true);
    expect(back.playerCharacter).toBe('villager');
    expect(back.party.members[0]?.name).toBe('Ash');
    // A plain game saves neither.
    const fresh = world();
    settle(fresh);
    const plain = fresh.toSave({ game: 'demo', playSeconds: 1 });
    expect(plain).not.toHaveProperty('playerHidden');
    expect(plain.party).not.toHaveProperty('looks');
  });
});
