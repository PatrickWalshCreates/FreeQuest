import { describe, expect, it } from 'vitest';
import { fitScale } from '../src/scale.js';

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
