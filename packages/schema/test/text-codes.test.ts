import { describe, expect, it } from 'vitest';
import { isTextColor, parseTextCodes, textCodeReferences } from '../src/index.js';

describe('parseTextCodes', () => {
  it('splits text into plain text and codes', () => {
    expect(parseTextCodes('{actor:hero} found {v:coins} {currency}!').tokens).toEqual([
      { kind: 'code', name: 'actor', arg: 'hero' },
      { kind: 'text', text: ' found ' },
      { kind: 'code', name: 'v', arg: 'coins' },
      { kind: 'text', text: ' ' },
      { kind: 'code', name: 'currency', arg: null },
      { kind: 'text', text: '!' },
    ]);
    expect(parseTextCodes('{color:red}Hot{/color} {icon:3} { color : #ff8800 }').tokens).toEqual([
      { kind: 'code', name: 'color', arg: 'red' },
      { kind: 'text', text: 'Hot' },
      { kind: 'code', name: '/color', arg: null },
      { kind: 'text', text: ' ' },
      { kind: 'code', name: 'icon', arg: '3' },
      { kind: 'text', text: ' ' },
      { kind: 'code', name: 'color', arg: '#ff8800' },
    ]);
  });

  it('reads {{ as a brace and leaves plain text alone', () => {
    const parsed = parseTextCodes('Use {{braces} like } this');
    expect(parsed.problems).toEqual([]);
    expect(parsed.tokens).toEqual([{ kind: 'text', text: 'Use {braces} like } this' }]);
    expect(parseTextCodes('').tokens).toEqual([]);
  });

  it('explains codes it cannot use, and keeps the rest', () => {
    const parsed = parseTextCodes(
      '{nope} {gold:5} {v} {v:Bad} {color:pink} {member:0} {icon:x} {actor:hero} {open',
    );
    expect(parsed.problems).toEqual([
      'unknown code {nope}',
      '{gold} takes nothing after it',
      '{v:…} needs an id',
      '{v:Bad}: "Bad" isn\'t an id',
      '{color:pink}: unknown colour "pink" (use white, gray, red, orange, yellow, green, blue, purple or #rrggbb)',
      '{member:0}: the position is a number from 1',
      '{icon:x}: the icon is a number from 0',
      '"{" at 75 is never closed (write {{ for a { on its own)',
    ]);
    expect(parsed.tokens.filter((t) => t.kind === 'code')).toEqual([
      { kind: 'code', name: 'actor', arg: 'hero' },
    ]);
  });

  it('lists the ids a text names, and knows its colours', () => {
    expect(textCodeReferences('{v:a}{actor:b}{item:c}{equipment:d}{v:e}')).toEqual({
      variables: ['a', 'e'],
      actors: ['b'],
      items: ['c'],
      equipment: ['d'],
    });
    expect(isTextColor('green')).toBe(true);
    expect(isTextColor('#A0b1C2')).toBe(true);
    expect(isTextColor('#abc')).toBe(false);
  });
});
