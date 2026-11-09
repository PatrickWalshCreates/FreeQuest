// What should be heard right now. Free of DOM/Web Audio so it can be tested
// in Node; `audio-player.ts` makes the actual sound.
import type { InputState } from '@freequest/core';
import type { SoundKey, SystemAudio } from '@freequest/schema';
import type { MenuOption } from './battle-controller.js';

/** Which screen the game is on, as far as music is concerned. */
export type MusicScene = 'title' | 'map' | 'battle' | 'victory' | 'gameOver';

export interface MusicTrack {
  readonly path: string;
  readonly loop: boolean;
}

/**
 * The track for a scene: the system's title/battle/victory/game-over music,
 * or the map's (as chosen by `World.music`). Victory plays once; the rest loop.
 */
export function musicFor(
  scene: MusicScene,
  audio: SystemAudio | undefined,
  mapMusic: string | null,
): MusicTrack | null {
  const path =
    scene === 'map'
      ? mapMusic
      : scene === 'title'
        ? audio?.titleMusic
        : scene === 'battle'
          ? audio?.battleMusic
          : scene === 'victory'
            ? audio?.victoryMusic
            : audio?.gameOverMusic;
  return path ? { path, loop: scene !== 'victory' } : null;
}

/** A list the player is moving through: its options and cursor (before this step's input). */
export interface MenuLike {
  readonly options: readonly MenuOption[];
  readonly cursor: number;
}

/**
 * The interface sound for this step's input on a menu: cursor moves,
 * confirming an enabled option, refusing a disabled one, or backing out.
 * `menu` is the state *before* the input is handled.
 */
export function uiSoundFor(input: InputState, menu: MenuLike | null): SoundKey | null {
  if (!menu) return null;
  if (input.justPressed('confirm')) {
    if (menu.options.length === 0) return null;
    return menu.options[menu.cursor]?.enabled ? 'confirm' : 'buzzer';
  }
  if (input.justPressed('cancel')) return 'cancel';
  const moved = (['up', 'down', 'left', 'right'] as const).some((a) => input.justPressed(a));
  return moved && menu.options.length > 1 ? 'cursor' : null;
}
