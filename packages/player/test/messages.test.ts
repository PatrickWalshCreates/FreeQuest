import { describe, expect, it } from 'vitest';
import { isFullscreenKey, startProblem } from '../src/messages.js';

describe('startProblem', () => {
  it('explains that a game opened from disk needs a host', () => {
    const problem = startProblem(new Error('x'), 'file:');
    expect(problem.title).toMatch(/website/);
    expect(problem.text).toMatch(/itch\.io/);
  });

  it('calls missing files missing', () => {
    const problem = startProblem(new Error('Failed to load project.json: HTTP 404'), 'https:');
    expect(problem.title).toMatch(/missing/);
    expect(problem.details).toBe('Error: Failed to load project.json: HTTP 404');
  });

  it('keeps the technical message for anything else', () => {
    const problem = startProblem(new TypeError('boom'), 'https:');
    expect(problem.title).toBe('This game couldn’t start');
    expect(problem.details).toBe('TypeError: boom');
    expect(startProblem('plain', 'http:').details).toBe('plain');
  });
});

describe('isFullscreenKey', () => {
  it('accepts F11 and Alt+Enter only', () => {
    expect(isFullscreenKey({ key: 'F11', altKey: false })).toBe(true);
    expect(isFullscreenKey({ key: 'Enter', altKey: true })).toBe(true);
    expect(isFullscreenKey({ key: 'Enter', altKey: false })).toBe(false);
  });
});
