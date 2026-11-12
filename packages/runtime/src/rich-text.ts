// Laying out a message's styled runs (core's `expandText`): word wrapping
// across colours and icons, then revealing it piece by piece. Free of PixiJS
// (text width comes from a `measure` function), so it's tested in Node;
// `dialog-view.ts` draws the pieces.
import type { TextRun } from '@freequest/core';

/** One drawable piece on a line, at `x` pixels; `start` is its first reveal unit. */
export type LinePiece =
  | {
      readonly kind: 'text';
      readonly x: number;
      readonly text: string;
      readonly color: string | null;
      readonly start: number;
    }
  | { readonly kind: 'icon'; readonly x: number; readonly icon: number; readonly start: number };

export interface RichLayout {
  readonly lines: readonly (readonly LinePiece[])[];
  /** Reveal units: one per character (line breaks don't count) and one per icon. */
  readonly length: number;
}

export interface LayoutOptions {
  readonly maxWidth: number;
  /** Width of some text, in pixels. */
  readonly measure: (text: string) => number;
  /** Width an icon takes up on a line, spacing included. */
  readonly iconWidth: number;
}

/** Reveal units in runs: characters other than line breaks, and icons. */
export function runsLength(runs: readonly TextRun[]): number {
  let n = 0;
  for (const run of runs) n += run.kind === 'icon' ? 1 : run.text.replace(/\n/g, '').length;
  return n;
}

type Atom =
  | { readonly kind: 'text'; readonly text: string; readonly color: string | null }
  | { readonly kind: 'space'; readonly text: string; readonly color: string | null }
  | { readonly kind: 'break' }
  | { readonly kind: 'icon'; readonly icon: number };

/** Split runs into words, spaces, line breaks and icons. */
function atoms(runs: readonly TextRun[]): Atom[] {
  const out: Atom[] = [];
  for (const run of runs) {
    if (run.kind === 'icon') {
      out.push(run);
      continue;
    }
    for (const part of run.text.split(/(\n|[^\S\n]+)/)) {
      if (!part) continue;
      if (part === '\n') out.push({ kind: 'break' });
      else if (/^\s+$/.test(part)) out.push({ kind: 'space', text: part, color: run.color });
      else out.push({ kind: 'text', text: part, color: run.color });
    }
  }
  return out;
}

/**
 * Wrap runs into lines no wider than `maxWidth` (a word wider than that gets
 * a line of its own). A word stays together even when it changes colour or
 * holds an icon, spaces at the start of a wrapped line are dropped, and
 * neighbouring pieces of one colour are merged.
 */
export function layoutRuns(runs: readonly TextRun[], options: LayoutOptions): RichLayout {
  const { maxWidth, measure, iconWidth } = options;
  const width = (a: Atom) =>
    a.kind === 'icon' ? iconWidth : a.kind === 'break' ? 0 : measure(a.text);

  // Group atoms into words (no spaces inside), keeping the spaces before each.
  type Word = { spaces: Atom[]; parts: Atom[]; breakBefore: boolean };
  const words: Word[] = [];
  let spaces: Atom[] = [];
  let breakBefore = false;
  let current: Word | null = null;
  for (const atom of atoms(runs)) {
    if (atom.kind === 'break') {
      current = null;
      spaces = [];
      // Two breaks in a row make an empty line: give it an empty word.
      if (breakBefore) words.push({ spaces: [], parts: [], breakBefore: true });
      breakBefore = true;
      continue;
    }
    if (atom.kind === 'space') {
      current = null;
      spaces.push(atom);
      continue;
    }
    if (!current) {
      current = { spaces, parts: [], breakBefore };
      words.push(current);
      spaces = [];
      breakBefore = false;
    }
    current.parts.push(atom);
  }

  const lines: LinePiece[][] = [];
  let line: LinePiece[] = [];
  let x = 0;
  let unit = 0;
  const place = (atom: Atom) => {
    if (atom.kind === 'break') return;
    if (atom.kind === 'icon') {
      line.push({ kind: 'icon', x, icon: atom.icon, start: unit });
      unit += 1;
    } else {
      const last = line.at(-1);
      if (last?.kind === 'text' && last.color === atom.color) {
        line[line.length - 1] = { ...last, text: last.text + atom.text };
      } else line.push({ kind: 'text', x, text: atom.text, color: atom.color, start: unit });
      unit += atom.text.length;
    }
    x += width(atom);
  };
  const newLine = () => {
    lines.push(line);
    line = [];
    x = 0;
  };

  words.forEach((word, i) => {
    if (word.breakBefore && i > 0) newLine();
    const spaceWidth = word.spaces.reduce((sum, a) => sum + width(a), 0);
    const wordWidth = word.parts.reduce((sum, a) => sum + width(a), 0);
    const fits = x === 0 || x + spaceWidth + wordWidth <= maxWidth;
    if (fits) {
      for (const s of word.spaces) place(s);
    } else {
      newLine();
      // The spaces that ended the last line still count for revealing.
      for (const s of word.spaces) unit += s.kind === 'space' ? s.text.length : 0;
    }
    for (const part of word.parts) place(part);
  });
  lines.push(line);
  // Spaces after the last word aren't drawn, but they count, like every character.
  for (const s of spaces) unit += s.kind === 'space' ? s.text.length : 0;
  return { lines, length: unit };
}

/** A piece as far as `revealed` units show it, or null if none of it is showing yet. */
export function revealPiece(piece: LinePiece, revealed: number): LinePiece | null {
  const shown = Math.floor(revealed) - piece.start;
  if (shown <= 0) return null;
  if (piece.kind === 'icon') return piece;
  return shown >= piece.text.length ? piece : { ...piece, text: piece.text.slice(0, shown) };
}
