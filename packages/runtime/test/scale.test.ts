import { describe, expect, it } from 'vitest';
import { MAX_RENDER_RESOLUTION, fitScale, renderResolution } from '../src/scale.js';

describe('fitScale', () => {
  it('picks the largest whole step that fits', () => {
    expect(fitScale(480, 352, 960, 704)).toBe(2);
    expect(fitScale(480, 352, 1920, 1080)).toBe(3);
    expect(fitScale(480, 352, 959, 2000)).toBe(2); // within the slack
  });

  it('allows a couple of pixels of overshoot, but no more', () => {
    expect(fitScale(480, 352, 960, 702)).toBe(2);
    expect(fitScale(480, 352, 960, 701)).toBe(1);
  });

  it('never goes below 1', () => {
    expect(fitScale(480, 352, 100, 100)).toBe(1);
  });
});

describe('renderResolution', () => {
  it('is 1 for pixel text, whatever the scale', () => {
    expect(renderResolution(3, 2, false)).toBe(1);
  });

  it('is the screen’s resolution for sharp text: the scale times the pixel ratio', () => {
    expect(renderResolution(2, 1, true)).toBe(2);
    expect(renderResolution(3, 2, true)).toBe(6);
    expect(renderResolution(2, 1.5, true)).toBe(3);
    // Never below the game's own pixels, never past the cap, and odd ratios count as 1.
    expect(renderResolution(1, 0.5, true)).toBe(1);
    expect(renderResolution(6, 2, true)).toBe(MAX_RENDER_RESOLUTION);
    expect(renderResolution(2, Number.NaN, true)).toBe(2);
  });
});
