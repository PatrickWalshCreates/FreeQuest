// M16 step 4: MZ traits that FreeQuest now has: counterattack, magic
// reflection and evasion, action times, and party abilities.
import { describe, expect, it } from 'vitest';
import { ImportReport, type TraitContext, traitModifiers } from '../src/index.js';

const trait = (code: number, dataId: number, value = 1) => ({ code, dataId, value });

describe('MZ combat traits', () => {
  it('become counter, reflect, magic evasion, extra action and party ability modifiers', () => {
    const report = new ImportReport();
    // These traits need nothing from the project's database or type lists.
    const ctx = { report } as unknown as TraitContext;
    const { modifiers } = traitModifiers(
      [
        trait(22, 4, 0.15),
        trait(22, 5, 0.5),
        trait(22, 6, 0.25),
        trait(61, 0, 0.3),
        trait(64, 0),
        trait(64, 1),
        trait(64, 4),
        trait(64, 5),
        trait(64, 2),
        trait(64, 3),
      ],
      ctx,
      'Actors › Hero',
      false,
    );
    expect(modifiers).toEqual([
      { type: 'magicEvasionRate', value: 0.15 },
      { type: 'reflectRate', value: 0.5 },
      { type: 'counterRate', value: 0.25 },
      { type: 'extraActions', value: 0.3 },
      { type: 'partyAbility', ability: 'fewerEncounters' },
      { type: 'partyAbility', ability: 'noEncounters' },
      { type: 'partyAbility', ability: 'doubleGold' },
      { type: 'partyAbility', ability: 'doubleDrops' },
    ]);
    // Surprise attacks and first strikes aren't in FreeQuest's battles: reported.
    expect(report.items.map((i) => i.message)).toEqual([
      "Traits FreeQuest doesn't have: no surprise attacks, more first strikes.",
    ]);
  });
});
