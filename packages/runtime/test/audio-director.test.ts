import { ActionState } from '@freequest/core';
import { describe, expect, it } from 'vitest';
import { musicFor, uiSoundFor } from '../src/audio-director.js';

const audio = {
  titleMusic: 'audio/title.wav',
  battleMusic: 'audio/battle.wav',
  victoryMusic: 'audio/victory.wav',
  gameOverMusic: 'audio/gameover.wav',
};

describe('musicFor', () => {
  it('picks the system track for each screen and the map track on the map', () => {
    expect(musicFor('title', audio, null)).toEqual({ path: 'audio/title.wav', loop: true });
    expect(musicFor('battle', audio, 'audio/meadow.wav')).toEqual({
      path: 'audio/battle.wav',
      loop: true,
    });
    expect(musicFor('victory', audio, null)).toEqual({ path: 'audio/victory.wav', loop: false });
    expect(musicFor('gameOver', audio, null)).toEqual({ path: 'audio/gameover.wav', loop: true });
    expect(musicFor('map', audio, 'audio/meadow.wav')).toEqual({
      path: 'audio/meadow.wav',
      loop: true,
    });
  });

  it('is silent where nothing is configured', () => {
    expect(musicFor('title', undefined, null)).toBeNull();
    expect(musicFor('map', audio, null)).toBeNull();
  });
});

describe('uiSoundFor', () => {
  const menu = {
    options: [
      { label: 'A', enabled: true },
      { label: 'B', enabled: false },
    ],
    cursor: 0,
  };
  const pressed = (...actions: Parameters<ActionState['press']>[0][]) => {
    const input = new ActionState();
    for (const a of actions) input.press(a);
    return input;
  };

  it('clicks on cursor moves, confirms enabled options and buzzes disabled ones', () => {
    expect(uiSoundFor(pressed('down'), menu)).toBe('cursor');
    expect(uiSoundFor(pressed('confirm'), menu)).toBe('confirm');
    expect(uiSoundFor(pressed('confirm'), { ...menu, cursor: 1 })).toBe('buzzer');
    expect(uiSoundFor(pressed('cancel'), menu)).toBe('cancel');
  });

  it('stays quiet without a menu, on single-option lists, and with no input', () => {
    expect(uiSoundFor(pressed('confirm'), null)).toBeNull();
    expect(
      uiSoundFor(pressed('down'), { options: [{ label: 'A', enabled: true }], cursor: 0 }),
    ).toBeNull();
    expect(uiSoundFor(pressed(), menu)).toBeNull();
    expect(uiSoundFor(pressed('confirm'), { options: [], cursor: 0 })).toBeNull();
  });
});
