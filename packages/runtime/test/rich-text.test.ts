import type { TextRun } from '@freequest/core';
import { describe, expect, it } from 'vitest';
import { layoutRuns, revealPiece, runsLength } from '../src/rich-text.js';

/** Every character is 6 px wide; icons take 10. */
const options = (maxWidth: number) => ({
  maxWidth,
  measure: (t: string) => t.length * 6,
  iconWidth: 10,
});
const text = (t: string, color: string | null = null): TextRun => ({
  kind: 'text',
  text: t,
  color,
});
const icon = (i: number): TextRun => ({ kind: 'icon', icon: i });

/** A line's pieces as readable strings: "x:text" or "x:[icon]". */
const show = (runs: TextRun[], maxWidth: number) =>
  layoutRuns(runs, options(maxWidth)).lines.map((line) =>
    line.map((p) =>
      p.kind === 'icon' ? `${p.x}:[${p.icon}]` : `${p.x}:${p.text}${p.color ? `(${p.color})` : ''}`,
    ),
  );

describe('layoutRuns', () => {
  it('wraps words to the width and drops spaces at the start of a wrapped line', () => {
    expect(show([text('one two three four')], 60)).toEqual([['0:one two'], ['0:three four']]);
  });

  it('keeps colours as pieces, and a word together across a colour change', () => {
    // "hot" + "dog" is one word (36 px), so it moves to the next line whole.
    expect(show([text('a '), text('hot', 'red'), text('dog is good')], 42)).toEqual([
      ['0:a'],
      ['0:hot(red)', '18:dog'],
      ['0:is good'],
    ]);
    expect(show([text('a '), text('hot', 'red'), text(' dog')], 200)).toEqual([
      ['0:a ', '12:hot(red)', '30: dog'],
    ]);
  });

  it('places icons in the text and breaks lines at \\n', () => {
    expect(show([text('Got '), icon(3), text(' potion\nNext')], 200)).toEqual([
      ['0:Got ', '24:[3]', '34: potion'],
      ['0:Next'],
    ]);
    expect(show([text('a\n\nb')], 200)).toEqual([['0:a'], [], ['0:b']]);
  });

  it('gives a word wider than the box a line of its own', () => {
    expect(show([text('hi incomprehensibilities ok')], 60)).toEqual([
      ['0:hi'],
      ['0:incomprehensibilities'],
      ['0:ok'],
    ]);
  });

  it('counts reveal units like the dialog does, and reveals piece by piece', () => {
    const runs = [text('ab '), icon(1), text(' cd\nef  ')];
    const layout = layoutRuns(runs, options(24));
    expect(layout.length).toBe(runsLength(runs));
    expect(runsLength(runs)).toBe(11);
    const pieces = layout.lines.flat();
    const at = (n: number) =>
      pieces
        .map((p) => revealPiece(p, n))
        .map((p) => (p === null ? '·' : p.kind === 'icon' ? '[]' : p.text));
    expect(at(0)).toEqual(['·', '·', '·', '·']);
    // At 24 px the icon and "cd" each wrap (the spaces before them aren't drawn but count).
    expect(layout.lines.map((l) => l.length)).toEqual([1, 1, 1, 1]);
    expect(at(2)).toEqual(['ab', '·', '·', '·']);
    expect(at(3)).toEqual(['ab', '·', '·', '·']);
    expect(at(4)).toEqual(['ab', '[]', '·', '·']);
    expect(at(6)).toEqual(['ab', '[]', 'c', '·']);
    expect(at(11)).toEqual(['ab', '[]', 'cd', 'ef']);
  });
});
