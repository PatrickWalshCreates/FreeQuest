// The game's own music and sounds: title, battle, victory and game-over
// music, and the sounds the engine plays itself. MZ lists 24 system sounds;
// FreeQuest's eight take the ones that do the same job.
import type { SoundKey, SystemAudio } from '@freequest/schema';
import type { AudioImporter } from './audio.js';
import { asArray, asRecord, asString } from './json.js';

/** Which of MZ's system sounds (by position) each FreeQuest sound uses. */
const SOUNDS: Readonly<Record<SoundKey, number>> = {
  cursor: 0,
  confirm: 1,
  cancel: 2,
  buzzer: 3,
  save: 5,
  battleStart: 7,
  damage: 10,
  heal: 16,
};

const name = (raw: unknown) => asString(asRecord(raw)['name']).trim();

export async function systemAudio(system: unknown, audio: AudioImporter): Promise<SystemAudio> {
  const s = asRecord(system);
  const where = 'System sounds';
  const music = async (key: string, folder: 'bgm' | 'me') =>
    audio.sound(folder, name(s[key]), where);
  const titleMusic = await music('titleBgm', 'bgm');
  const battleMusic = await music('battleBgm', 'bgm');
  const victoryMusic = await music('victoryMe', 'me');
  const gameOverMusic = await music('gameoverMe', 'me');
  const list = asArray(s['sounds']);
  const sounds: Partial<Record<SoundKey, string>> = {};
  for (const [key, i] of Object.entries(SOUNDS) as [SoundKey, number][]) {
    const path = await audio.sound('se', name(list[i]), where);
    if (path) sounds[key] = path;
  }
  return {
    ...(titleMusic ? { titleMusic } : {}),
    ...(battleMusic ? { battleMusic } : {}),
    ...(victoryMusic ? { victoryMusic } : {}),
    ...(gameOverMusic ? { gameOverMusic } : {}),
    ...(Object.keys(sounds).length > 0 ? { sounds } : {}),
  };
}
