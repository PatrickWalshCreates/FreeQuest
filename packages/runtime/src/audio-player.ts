import type { MusicTrack } from './audio-director.js';

const MUSIC_FADE_SECONDS = 0.4;

interface Playing {
  readonly track: MusicTrack;
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

/**
 * One crossfading track at a time (the music, or the background sound): asking
 * for another fades the old one out and the new one in once it has loaded.
 */
class Channel {
  private wanted: MusicTrack | null = null;
  private playing: Playing | null = null;
  /** Bumped on every change, so a slow load can't start a track no longer wanted. */
  private generation = 0;

  constructor(
    private readonly player: { readonly context: AudioContext | null },
    private readonly load: (path: string) => Promise<AudioBuffer | null>,
    private readonly volume: () => number,
  ) {}

  /** Play a track (or silence). Asking for what's already wanted does nothing. */
  set(track: MusicTrack | null): void {
    if (sameTrack(track, this.wanted)) return;
    this.wanted = track;
    this.start();
  }

  /** Start what's wanted now that there's a context (after `unlock()`). */
  restart(): void {
    if (!this.playing) this.start();
  }

  private start(): void {
    const context = this.player.context;
    const track = this.wanted;
    if (!context) return;
    const generation = ++this.generation;
    this.fadeOutCurrent(context);
    if (!track) return;
    void this.load(track.path).then((buffer) => {
      if (!buffer || generation !== this.generation || this.player.context !== context) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = track.loop;
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(this.volume(), context.currentTime + MUSIC_FADE_SECONDS);
      source.connect(gain).connect(context.destination);
      source.start();
      this.playing = { track, source, gain };
    });
  }

  /** The volume changed: the track playing follows at once. */
  follow(): void {
    const current = this.playing;
    const context = this.player.context;
    if (!current || !context) return;
    const now = context.currentTime;
    current.gain.gain.cancelScheduledValues(now);
    current.gain.gain.setValueAtTime(this.volume(), now);
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
}

/**
 * Plays music (crossfaded, looping or once), a looping background sound
 * beside it (at the sound volume) and sound effects with the Web Audio API.
 * Browsers only allow audio after a user gesture: `unlock()` is tried when
 * the game starts (it plays at once where sound is already allowed) and again
 * on every key press, which resumes a context the browser held back; what was
 * asked for before then starts at that point. Missing or broken files are
 * logged once and then ignored, so a bad path never stops the game.
 */
export class AudioPlayer {
  context: AudioContext | null = null;
  private readonly buffers = new Map<string, Promise<AudioBuffer | null>>();
  musicVolume = 0.5;
  soundVolume = 0.7;
  private readonly music = new Channel(
    this,
    (path) => this.load(path),
    () => this.musicVolume,
  );
  private readonly background = new Channel(
    this,
    (path) => this.load(path),
    () => this.soundVolume,
  );

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
      this.music.restart();
      this.background.restart();
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  /** Play a track (or silence). Asking for what's already playing does nothing. */
  setMusic(track: MusicTrack | null): void {
    this.music.set(track);
  }

  /** Loop a background sound beside the music (or none). */
  setBackground(path: string | null): void {
    this.background.set(path ? { path, loop: true } : null);
  }

  /** Change the volumes (0..1); what's playing now follows at once. */
  setVolumes(music: number, sound: number): void {
    this.musicVolume = music;
    this.soundVolume = sound;
    this.music.follow();
    this.background.follow();
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
