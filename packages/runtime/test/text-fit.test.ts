import { describe, expect, it } from 'vitest';
import { fitText } from '../src/text-fit.js';

// One unit per character.
const width = (text: string) => [...text].length;

describe('fitText', () => {
  it('keeps text that fits', () => {
    expect(fitText('Slot 1: Meadow', 20, width)).toBe('Slot 1: Meadow');
  });

  it('shortens with an ellipsis to the longest prefix that fits', () => {
    expect(fitText('Slot 1: Village', 10, width)).toBe('Slot 1: V…');
    expect(fitText('Slot 1: Village', 9, width)).toBe('Slot 1:…');
  });

  it('falls back to just the ellipsis', () => {
    expect(fitText('Village', 1, width)).toBe('…');
    expect(fitText('Village', 0, width)).toBe('…');
  });
});
