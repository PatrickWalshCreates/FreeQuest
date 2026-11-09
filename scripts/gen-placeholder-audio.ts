// Generates FreeQuest's original placeholder audio for the demo project:
// short chiptune music loops and interface/battle sound effects, synthesized
// from square, triangle and noise waves. Melodies come from a seeded random
// walk over each track's scale, so output is original and byte-identical on
// every run. Written as 8-bit mono WAV at 16 kHz to keep files small.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'samples',
  'demo-project',
  'assets',
  'audio',
);
const RATE = 16000;

type Wave = 'square' | 'pulse' | 'triangle' | 'sine' | 'noise';

/** A mono sample buffer that notes are mixed into. */
class Track {
  readonly samples: Float32Array;
  constructor(readonly seconds: number) {
    this.samples = new Float32Array(Math.ceil(seconds * RATE));
  }

  /**
   * Mix one note in. `glide` multiplies the frequency over the note (pitch
   * sweeps). Attack/release keep notes click-free.
   */
  note(start: number, duration: number, freq: number, wave: Wave, volume: number, glide = 1): void {
    const first = Math.floor(start * RATE);
    const length = Math.floor(duration * RATE);
    const attack = Math.min(0.005 * RATE, length / 4);
    const release = Math.min(0.04 * RATE, length / 2);
    let phase = 0;
    let noiseValue = 0;
    let noiseSeed = Math.floor(freq * 1000) + first;
    for (let i = 0; i < length; i++) {
      const index = first + i;
      if (index >= this.samples.length) break;
      const f = freq * glide ** (i / length);
      phase += f / RATE;
      const p = phase % 1;
      let v: number;
      switch (wave) {
        case 'square':
          v = p < 0.5 ? 1 : -1;
          break;
        case 'pulse':
          v = p < 0.125 ? 1 : -1;
          break;
        case 'triangle':
          v = p < 0.5 ? 4 * p - 1 : 3 - 4 * p;
          break;
        case 'sine':
          v = Math.sin(2 * Math.PI * p);
          break;
        case 'noise':
          // A new random value at `freq` Hz gives pitched "crunch".
          if (Math.floor(phase) !== Math.floor(phase - f / RATE) || i === 0) {
            noiseSeed = (noiseSeed * 1103515245 + 12345) % 2147483648;
            noiseValue = (noiseSeed / 2147483648) * 2 - 1;
          }
          v = noiseValue;
          break;
      }
      const envelope = Math.min(1, i / attack, (length - i) / release);
      this.samples[index] = (this.samples[index] ?? 0) + v * volume * envelope;
    }
  }

  /** Normalize to a safe peak and write 8-bit unsigned PCM WAV. */
  save(name: string): void {
    let peak = 0;
    for (const s of this.samples) peak = Math.max(peak, Math.abs(s));
    const gain = peak > 0 ? 0.9 / peak : 1;
    const data = Buffer.alloc(this.samples.length);
    this.samples.forEach((s, i) =>
      data.writeUInt8(Math.max(0, Math.min(255, Math.round(128 + s * gain * 127))), i),
    );
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + data.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(RATE, 24);
    header.writeUInt32LE(RATE, 28); // byte rate (1 byte per sample)
    header.writeUInt16LE(1, 32); // block align
    header.writeUInt16LE(8, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(data.length, 40);
    mkdirSync(OUT, { recursive: true });
    const path = join(OUT, `${name}.wav`);
    writeFileSync(path, Buffer.concat([header, data]));
    console.log(`wrote ${path} (${(data.length / RATE).toFixed(1)} s)`);
  }
}

/** Frequency of a MIDI note number (69 = A4 = 440 Hz). */
const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Deterministic pseudo-random numbers in [0, 1). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

interface Song {
  name: string;
  bpm: number;
  /** Chord roots (MIDI) and chord tones (semitones above the root), one chord per bar. */
  chords: { root: number; tones: number[] }[];
  /** Scale (MIDI notes) the melody walks over. */
  scale: number[];
  seed: number;
  lead: Wave;
  /** Melody notes per beat (1 = quarter notes, 2 = eighths). */
  leadDensity: number;
  drums: boolean;
  arpeggio: boolean;
}

const major = (tonic: number) => [0, 2, 4, 5, 7, 9, 11, 12, 14, 16].map((d) => tonic + d);
const minor = (tonic: number) => [0, 2, 3, 5, 7, 8, 10, 12, 14, 15].map((d) => tonic + d);
const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];
const MAJ7 = [0, 4, 7, 11];
const MIN7 = [0, 3, 7, 10];
const DOM7 = [0, 4, 7, 10];

function compose(song: Song): Track {
  const beat = 60 / song.bpm;
  const bar = beat * 4;
  const track = new Track(song.chords.length * bar);
  const random = seeded(song.seed);
  let degree = 4;

  song.chords.forEach((chord, b) => {
    const t0 = b * bar;
    // Bass: root on 1 and 3, fifth on 2 and 4 (an octave below the chord).
    for (let i = 0; i < 4; i++) {
      const note = chord.root - 12 + (i % 2 === 1 ? 7 : 0);
      track.note(t0 + i * beat, beat * 0.9, hz(note), 'triangle', 0.5);
    }
    // Arpeggio: chord tones in eighths, quiet.
    if (song.arpeggio) {
      for (let i = 0; i < 8; i++) {
        const tone = chord.tones[i % chord.tones.length] ?? 0;
        track.note(
          t0 + i * (beat / 2),
          (beat / 2) * 0.8,
          hz(chord.root + 12 + tone),
          'pulse',
          0.08,
        );
      }
    }
    // Melody: a random walk over the scale, landing on chord tones on the beat.
    const steps = 4 * song.leadDensity;
    const step = beat / song.leadDensity;
    for (let i = 0; i < steps; i++) {
      if (random() < 0.18 && i > 0) continue; // rests keep it breathing
      degree = Math.max(
        0,
        Math.min(song.scale.length - 1, degree + Math.round((random() - 0.5) * 4)),
      );
      let note = song.scale[degree] ?? song.scale[0] ?? 60;
      if (i % song.leadDensity === 0) {
        // Snap to the nearest chord tone on strong beats.
        const tones = chord.tones.map((t) => chord.root + 12 + t);
        note = tones.reduce(
          (best, t) => (Math.abs(t - note) < Math.abs(best - note) ? t : best),
          tones[0] ?? note,
        );
      }
      const length = random() < 0.25 && i < steps - 1 ? step * 2 : step;
      track.note(t0 + i * step, length * 0.92, hz(note), song.lead, 0.22);
    }
    // Drums: kick on 1 and 3, snare on 2 and 4, hats on eighths.
    if (song.drums) {
      for (let i = 0; i < 8; i++) {
        const t = t0 + i * (beat / 2);
        track.note(t, 0.03, 9000, 'noise', 0.05);
        if (i % 4 === 0) track.note(t, 0.12, 120, 'sine', 0.6, 0.35);
        if (i % 4 === 2) track.note(t, 0.1, 3000, 'noise', 0.22);
      }
    }
  });
  return track;
}

const SONGS: Song[] = [
  {
    name: 'title',
    bpm: 84,
    chords: [
      { root: 60, tones: MAJ7 },
      { root: 57, tones: MIN7 },
      { root: 53, tones: MAJ7 },
      { root: 55, tones: DOM7 },
    ],
    scale: major(72),
    seed: 11,
    lead: 'triangle',
    leadDensity: 1,
    drums: false,
    arpeggio: true,
  },
  {
    name: 'meadow',
    bpm: 120,
    chords: [
      { root: 62, tones: MAJ },
      { root: 57, tones: MAJ },
      { root: 59, tones: MIN },
      { root: 55, tones: MAJ },
      { root: 62, tones: MAJ },
      { root: 57, tones: MAJ },
      { root: 55, tones: MAJ },
      { root: 57, tones: DOM7 },
    ],
    scale: major(74),
    seed: 23,
    lead: 'square',
    leadDensity: 2,
    drums: true,
    arpeggio: false,
  },
  {
    name: 'house',
    bpm: 90,
    chords: [
      { root: 65, tones: MAJ },
      { root: 62, tones: MIN },
      { root: 58, tones: MAJ },
      { root: 60, tones: MAJ },
    ],
    scale: major(77),
    seed: 37,
    lead: 'triangle',
    leadDensity: 1,
    drums: false,
    arpeggio: true,
  },
  {
    name: 'battle',
    bpm: 156,
    chords: [
      { root: 57, tones: MIN },
      { root: 53, tones: MAJ },
      { root: 55, tones: MAJ },
      { root: 52, tones: MAJ },
      { root: 57, tones: MIN },
      { root: 53, tones: MAJ },
      { root: 50, tones: MIN },
      { root: 52, tones: DOM7 },
    ],
    scale: minor(69),
    seed: 41,
    lead: 'square',
    leadDensity: 2,
    drums: true,
    arpeggio: true,
  },
  {
    name: 'gameover',
    bpm: 70,
    chords: [
      { root: 57, tones: MIN },
      { root: 50, tones: MIN },
      { root: 52, tones: MAJ },
      { root: 57, tones: MIN },
    ],
    scale: minor(69),
    seed: 53,
    lead: 'triangle',
    leadDensity: 1,
    drums: false,
    arpeggio: false,
  },
];

function victory(): Track {
  const t = new Track(3);
  const fanfare = [72, 76, 79, 84];
  fanfare.forEach((n, i) => t.note(i * 0.12, 0.12, hz(n), 'square', 0.25));
  for (const n of [72, 76, 79, 84]) t.note(0.5, 2.3, hz(n), n === 84 ? 'square' : 'triangle', 0.2);
  t.note(0.5, 2.3, hz(48), 'triangle', 0.5);
  return t;
}

/** Sound effects: name → how to draw it. */
const SOUNDS: Record<string, () => Track> = {
  cursor: () => {
    const t = new Track(0.05);
    t.note(0, 0.04, 1400, 'pulse', 0.4);
    return t;
  },
  confirm: () => {
    const t = new Track(0.14);
    t.note(0, 0.06, 880, 'square', 0.3);
    t.note(0.06, 0.07, 1320, 'square', 0.3);
    return t;
  },
  cancel: () => {
    const t = new Track(0.14);
    t.note(0, 0.06, 1100, 'square', 0.3);
    t.note(0.06, 0.07, 660, 'square', 0.3);
    return t;
  },
  buzzer: () => {
    const t = new Track(0.18);
    t.note(0, 0.16, 140, 'square', 0.4);
    t.note(0, 0.16, 147, 'square', 0.3);
    return t;
  },
  damage: () => {
    const t = new Track(0.16);
    t.note(0, 0.14, 1800, 'noise', 0.6, 0.2);
    t.note(0, 0.1, 220, 'square', 0.2, 0.5);
    return t;
  },
  heal: () => {
    const t = new Track(0.4);
    [76, 79, 83, 88].forEach((n, i) => t.note(i * 0.07, 0.14, hz(n), 'triangle', 0.35));
    return t;
  },
  save: () => {
    const t = new Track(0.5);
    [72, 79, 84].forEach((n, i) => t.note(i * 0.1, 0.3, hz(n), 'triangle', 0.35));
    return t;
  },
  battleStart: () => {
    const t = new Track(0.6);
    t.note(0, 0.35, 400, 'noise', 0.4, 6);
    [69, 72, 76, 81].forEach((n, i) => t.note(0.25 + i * 0.06, 0.1, hz(n), 'square', 0.25));
    return t;
  },
};

for (const song of SONGS) compose(song).save(song.name);
victory().save('victory');
for (const [name, draw] of Object.entries(SOUNDS)) draw().save(`sfx-${name}`);
