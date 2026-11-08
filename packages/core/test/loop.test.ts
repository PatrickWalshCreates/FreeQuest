import { describe, expect, it } from 'vitest';
import { FixedTimestep, computeCamera } from '../src/index.js';

describe('FixedTimestep', () => {
  it('runs whole steps and returns the leftover as alpha', () => {
    const loop = new FixedTimestep({ stepsPerSecond: 10 });
    let steps = 0;
    const alpha = loop.advance(0.25, () => steps++);
    expect(steps).toBe(2);
    expect(alpha).toBeCloseTo(0.5);
  });

  it('is independent of how real time is sliced into frames', () => {
    const a = new FixedTimestep();
    const b = new FixedTimestep();
    let stepsA = 0;
    let stepsB = 0;
    a.advance(0.2, () => stepsA++);
    for (let i = 0; i < 25; i++) b.advance(0.008, () => stepsB++);
    expect(stepsA).toBe(12);
    expect(stepsB).toBe(12);
  });

  it('clamps very long frames', () => {
    const loop = new FixedTimestep({ stepsPerSecond: 60, maxFrameTime: 0.1 });
    let steps = 0;
    loop.advance(5, () => steps++);
    expect(steps).toBe(6);
  });
});

describe('computeCamera', () => {
  const base = { viewWidth: 100, viewHeight: 50, mapWidth: 300, mapHeight: 200 };

  it('centers on the focus point', () => {
    expect(computeCamera({ ...base, focusX: 150, focusY: 100 })).toEqual({ x: 100, y: 75 });
  });

  it('clamps to the map edges', () => {
    expect(computeCamera({ ...base, focusX: 10, focusY: 10 })).toEqual({ x: 0, y: 0 });
    expect(computeCamera({ ...base, focusX: 299, focusY: 199 })).toEqual({ x: 200, y: 150 });
  });

  it('centers maps smaller than the view', () => {
    expect(computeCamera({ ...base, mapWidth: 60, focusX: 0, focusY: 0 }).x).toBe(-20);
  });
});
