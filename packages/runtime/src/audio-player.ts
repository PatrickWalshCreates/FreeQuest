import type { MusicTrack } from './audio-director.js';

const MUSIC_FADE_SECONDS = 0.4;

interface Playing {
  readonly track: MusicTrack;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

/**
 * Plays music (crossfaded, looping or once) and sound effects with the Web
 * Audio API. Browsers only allow audio after a user gesture, so nothing
 * plays until `unlock()` is called from a key press; the music asked for
 * before then starts at that point. Missing or broken files are logged once
 * and then ignored, so a bad path never stops the game.
 */
export class AudioPlayer {
  private context: AudioContext | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  private wanted: MusicTrack | null = null;
  private playing: Playing | null = null;
  /** Bumped on every music change, so a slow load can't start a track no longer wanted. */
  private generation = 0;
  musicVolume = 0.5;
  soundVolume = 0.7;

  constructor(private readonly resolve: (path: string) => Promise<string>) {}

  /** Call from a user gesture (key press). Safe to call repeatedly. */
  unlock(): void {
    if (!this.context) {
      try {
        this.context = new AudioContext();
      } catch (error) {
        console.warn('Web Audio is unavailable; the game will be silent.', error);
        return;
      }
      const wanted = this.wanted;
      this.wanted = null;
      this.setMusic(wanted);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** Play a track (or silence). Asking for what's already playing does nothing. */
  setMusic(track: MusicTrack | null): void {
    if (sameTrack(track, this.wanted)) return;
    this.wanted = track;
    const context = this.context;
    if (!context) return;
    const generation = ++this.generation;
    this.fadeOutCurrent(context);
    if (!track) return;
    void this.load(track.path).then((buffer) => {
      if (!buffer || generation !== this.generation || this.context !== context) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = track.loop;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(this.musicVolume, context.currentTime + MUSIC_FADE_SECONDS);
      source.connect(gain).connect(context.destination);
      source.start();
      this.playing = { track, source, gain };
    });
  }

  playSound(path: string): void {
    const context = this.context;
    if (!context) return;
    void this.load(path).then((buffer) => {
      if (!buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      const gain = context.createGain();
      gain.gain.value = this.soundVolume;
      source.connect(gain).connect(context.destination);
      source.start();
    });
  }

  private fadeOutCurrent(context: AudioContext): void {
    const current = this.playing;
    this.playing = null;
    if (!current) return;
    const now = context.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(current.gain.gain.value, now);
    current.gain.gain.linearRampToValueAtTime(0, now + MUSIC_FADE_SECONDS);
    current.source.stop(now + MUSIC_FADE_SECONDS + 0.05);
  }

  private load(path: string): Promise<AudioBuffer | null> {
    let buffer = this.buffers.get(path);
    if (!buffer) {
      const context = this.context;
      buffer = (async () => {
        if (!context) return null;
        try {
          const response = await fetch(await this.resolve(path));
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch (error) {
          console.warn(`Could not load audio "${path}"`, error);
          return null;
        }
      })();
      this.buffers.set(path, buffer);
    }
    return buffer;
  }

  /** Stop everything and release the audio device. */
  destroy(): void {
    void this.context?.close();
    this.context = null;
  }
}

function sameTrack(a: MusicTrack | null, b: MusicTrack | null): boolean {
  return a?.path === b?.path && a?.loop === b?.loop;
}
