import { describe, expect, it } from 'vitest';
import { GameState, Interpreter, Party, expandPlainText, expandText } from '../src/index.js';
import { demoDb } from './demo-db.js';

function context() {
  const db = demoDb();
  const state = new GameState({
    switches: [],
    variables: [{ id: 'coins', name: 'Coins' }],
  });
  const party = Party.start(db, { party: ['hero', 'mira'], gold: 50 });
  return { state, party };
}

describe('text codes', () => {
  it('fills in values when the text is shown', () => {
    const ctx = context();
    ctx.state.setVariable('coins', 7);
    expect(
      expandPlainText(
        '{member:1} and {actor:mira} have {v:coins} coins, {gold} {currency}, a {item:potion}{member:3}.',
        ctx,
      ),
    ).toBe('Hero and Mira have 7 coins, 50 G, a Potion.');
  });

  it('colours text until {/color}, nests colours and places icons', () => {
    expect(
      expandText('a{color:red}b{color:#00ff00}c{/color}d{/color}e{icon:3}{icon:4}', context()),
    ).toEqual([
      { kind: 'text', text: 'a', color: null },
      { kind: 'text', text: 'b', color: 'red' },
      { kind: 'text', text: 'c', color: '#00ff00' },
      { kind: 'text', text: 'd', color: 'red' },
      { kind: 'text', text: 'e', color: null },
      { kind: 'icon', icon: 3 },
      { kind: 'icon', icon: 4 },
    ]);
  });

  it('shows nothing for codes with problems, and needs the party for party codes', () => {
    expect(expandPlainText('x{nope}y{{z', context())).toBe('xy{z');
    expect(() => expandPlainText('{gold}', new GameState())).toThrow(/needs the party/);
  });

  it('expands messages, speakers and choices in the interpreter', () => {
    const ctx = context();
    ctx.state.setVariable('coins', 2);
    const it = new Interpreter(
      [
        {
          type: 'message',
          speaker: '{actor:mira}',
          text: 'I have {color:yellow}{v:coins}{/color}.',
        },
        { type: 'choice', options: [{ label: 'Give {item:potion}', commands: [] }] },
      ],
      ctx,
    );
    it.update(0);
    expect(it.pending).toEqual({
      type: 'message',
      speaker: 'Mira',
      text: 'I have 2.',
      runs: [
        { kind: 'text', text: 'I have ', color: null },
        { kind: 'text', text: '2', color: 'yellow' },
        { kind: 'text', text: '.', color: null },
      ],
    });
    it.continue();
    it.update(0);
    expect(it.pending).toMatchObject({ type: 'choice', options: ['Give Potion'] });
  });
});
