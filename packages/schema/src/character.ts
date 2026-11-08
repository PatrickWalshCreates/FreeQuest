import Type, { type Static } from 'typebox';
import { Direction, Id, NonNegativeInt, PositiveInt, RelativePath } from './common.js';

export const CHARACTER_FORMAT_VERSION = 1;

/**
 * A walking character sprite sheet: one row per direction (in `rows` order),
 * `frames` columns per row. `walkCycle` lists the column shown at each step of
 * the walk animation; `idleFrame` is shown when standing still.
 */
export const CharacterSheet = Type.Object(
  {
    formatVersion: Type.Literal(CHARACTER_FORMAT_VERSION),
    id: Id,
    name: Type.String(),
    image: RelativePath,
    frameWidth: PositiveInt,
    frameHeight: PositiveInt,
    frames: PositiveInt,
    rows: Type.Array(Direction, { minItems: 4, maxItems: 4, uniqueItems: true }),
    idleFrame: NonNegativeInt,
    walkCycle: Type.Array(NonNegativeInt, { minItems: 1 }),
  },
  { title: 'FreeQuest character sheet', additionalProperties: false },
);
export type CharacterSheet = Static<typeof CharacterSheet>;
