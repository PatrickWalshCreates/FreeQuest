import { describe, expect, it } from 'vitest';
import { openProject, previewText, textProblems } from '../src/index.js';
import { DEMO, memoryCopy } from './helpers.js';

const demo = async () => openProject(await memoryCopy(DEMO));

describe('message previews', () => {
  it('fills in names, and stand-ins for values only the game knows', async () => {
    const project = await demo();
    expect(
      previewText(
        '{member:1} has {v:bridge_visits} visits, {gold} {currency}, a {item:potion} {icon:2}{color:red}!{/color}',
        project,
      ),
    ).toEqual([
      {
        kind: 'text',
        text: 'Hero has [Times the bridge was crossed] visits, 50 G, a Potion ',
        color: null,
      },
      { kind: 'icon', icon: 2 },
      { kind: 'text', text: '!', color: 'red' },
    ]);
  });

  it('reports bad codes and ids the project lacks', async () => {
    const project = await demo();
    expect(textProblems('Hi {actor:mira}, {v:bridge_visits}', project)).toEqual([]);
    expect(textProblems('{v:nope} {actor:ghost} {item:x} {equipment:y} {zap}', project)).toEqual([
      'unknown code {zap}',
      '{v:nope}: there\'s no variable "nope"',
      '{actor:ghost}: there\'s no actor "ghost"',
      '{item:x}: there\'s no item "x"',
      '{equipment:y}: there\'s no equipment "y"',
    ]);
  });
});
