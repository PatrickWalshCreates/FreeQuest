// Where enemies stand on the battle screen (M16 step 2): the troop's own
// places, or an even row. Shared by the game's battle screen and the editor's
// troop layout, so both show the same thing.

export interface TroopPlace {
  /** The enemy's feet, in pixels of the game screen. */
  readonly x: number;
  readonly y: number;
}

/** How far down the screen the automatic row stands. */
export const AUTOMATIC_ROW = 0.6;

/** An even row across the screen, `AUTOMATIC_ROW` of the way down. */
export function automaticPlaces(count: number, width: number, height: number): TroopPlace[] {
  const y = Math.round(height * AUTOMATIC_ROW);
  return Array.from({ length: count }, (_, i) => ({
    x: Math.round(((i + 1) * width) / (count + 1)),
    y,
  }));
}

/**
 * Where each of `count` enemies stands: the troop's places when there's one
 * per enemy (kept on the screen), else the automatic row.
 */
export function enemyPlaces(
  count: number,
  width: number,
  height: number,
  places: readonly TroopPlace[] | undefined,
): TroopPlace[] {
  if (!places || places.length !== count) return automaticPlaces(count, width, height);
  const clamp = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(v)));
  return places.map((p) => ({ x: clamp(p.x, width), y: clamp(p.y, height) }));
}
