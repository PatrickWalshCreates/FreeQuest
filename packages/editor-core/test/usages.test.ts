import { describe, expect, it } from 'vitest';
import { openProject, projectReferences, referencesTo, usagesOf } from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const demo = async () => openProject(await memoryCopy(DEMO));

describe('the reference index', () => {
  it('finds switches and variables in conditions, commands and text codes', async () => {
    const project = await demo();
    expect(usagesOf(project, 'switch', 'accepted_request')).toEqual(
      expect.arrayContaining(["Elder's house › Hearth (page 2)"]),
    );
    const visits = referencesTo(project, 'variable', 'bridge_visits');
    expect(visits.length).toBeGreaterThan(0);
    expect(visits.every((r) => r.file.startsWith('data/maps/'))).toBe(true);
  });

  it('finds items and equipment by their kind, also in shops, drops and text codes', async () => {
    const project = await demo();
    const potion = referencesTo(project, 'item', 'potion');
    const places = potion.map((r) => r.where);
    expect(places).toEqual(
      expect.arrayContaining(["Elder's house › Chest (page 1)", 'Enemies › Slime']),
    );
    // The chest's message says {item:potion}: that's a use too, inside the text.
    expect(potion.some((r) => r.inText && r.where.startsWith("Elder's house › Chest"))).toBe(true);
    // An item's own id isn't a use of it.
    expect(potion.some((r) => r.file.endsWith('items.json'))).toBe(false);
  });

  it('finds actors, characters, tilesets, troops, common events and assets', async () => {
    const project = await demo();
    expect(usagesOf(project, 'actor', 'hero')).toContain('Project settings');
    expect(usagesOf(project, 'character', 'hero')).toEqual(
      expect.arrayContaining(['Project settings', 'Actors › Hero']),
    );
    expect(usagesOf(project, 'character', 'chest')).toEqual([
      "Elder's house › Chest (page 1)",
      "Elder's house › Chest (page 2)",
    ]);
    expect(usagesOf(project, 'tileset', 'overworld').sort()).toEqual(["Elder's house", 'Meadow']);
    expect(usagesOf(project, 'commonEvent', 'rest')).toEqual(["Elder's house › Hearth (page 2)"]);
    expect(usagesOf(project, 'troop', 'bridge-wolf').length).toBe(1);
    expect(usagesOf(project, 'asset', 'assets/system/iconset.png')).toEqual(['System']);
    expect(usagesOf(project, 'asset', 'assets/characters/chest.png')).toEqual(['Character Chest']);
    expect(usagesOf(project, 'skill', 'attack')).toContain('System');
  });

  it('scopes events to their map and leaves "player" and "this" out', async () => {
    const project = await demo();
    const events = projectReferences(project).filter((r) => r.kind === 'event');
    expect(events.every((r) => /^[a-z0-9_-]+\/[a-z0-9_-]+$/.test(r.id))).toBe(true);
    expect(events.some((r) => r.id.endsWith('/player') || r.id.endsWith('/this'))).toBe(false);
  });

  it('records where each one is, so a rename can rewrite it', async () => {
    const project = await demo();
    const [first] = referencesTo(project, 'tileset', 'overworld');
    expect(first?.path).toEqual(['tileset']);
    const hero = referencesTo(project, 'actor', 'hero').find((r) => r.where === 'Project settings');
    expect(hero?.path).toEqual(['start', 'party', 0]);
  });
});
