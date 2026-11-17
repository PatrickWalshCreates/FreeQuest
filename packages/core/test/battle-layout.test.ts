// M16 step 2: where a troop's enemies stand in battle.
import { checkDatabase, emptyDatabase } from '@freequest/schema';
import { describe, expect, it } from 'vitest';
import { automaticPlaces, enemyPlaces } from '../src/index.js';
import { demoDb } from './demo-db.js';

describe('troop places', () => {
  it('default to an even row 60% down the screen', () => {
    expect(automaticPlaces(3, 480, 352)).toEqual([
      { x: 120, y: 211 },
      { x: 240, y: 211 },
      { x: 360, y: 211 },
    ]);
  });

  it('use the troop’s own when there’s one per enemy, kept on the screen', () => {
    expect(
      enemyPlaces(2, 480, 352, [
        { x: 100, y: 200 },
        { x: 900, y: -5 },
      ]),
    ).toEqual([
      { x: 100, y: 200 },
      { x: 480, y: 0 },
    ]);
    // A count that doesn't match (an enemy added since) falls back to the row.
    expect(enemyPlaces(2, 480, 352, [{ x: 1, y: 1 }])).toEqual(automaticPlaces(2, 480, 352));
    expect(enemyPlaces(1, 480, 352, undefined)).toEqual(automaticPlaces(1, 480, 352));
  });

  it('are reported when their count doesn’t match the enemies', () => {
    const db = demoDb();
    const troop = db.troops.all[0];
    if (!troop) throw new Error('the demo has troops');
    const enemies = db.enemies.all;
    const problems = checkDatabase({
      ...emptyDatabase(),
      enemies,
      troops: [
        { ...troop, places: [{ x: 1, y: 1 }, ...troop.enemies.map(() => ({ x: 2, y: 2 }))] },
      ],
    });
    expect(problems).toContainEqual(
      `troops "${troop.id}" places: ${troop.enemies.length + 1} for ${troop.enemies.length} enemies, so they stand in the automatic row (set the places again)`,
    );
  });
});
