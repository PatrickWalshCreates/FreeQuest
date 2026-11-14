// MZ damage formulas are JavaScript; FreeQuest's are its own small language
// and never run JavaScript. The common subset translates word for word
// (a.atk → a.attack, Math.floor → floor, v[3] → v.<id>); anything else is
// left for the author, with the original kept in the report.
import { checkFormula } from '@freequest/schema';

/** MZ's short stat names → FreeQuest's (also hp, mp, level, which are the same). */
const SUBJECT_KEYS: Readonly<Record<string, string>> = {
  mhp: 'maxHp',
  mmp: 'maxMp',
  atk: 'attack',
  def: 'defense',
  mat: 'magicAttack',
  mdf: 'magicDefense',
  agi: 'agility',
  luk: 'luck',
  hp: 'hp',
  mp: 'mp',
  level: 'level',
};

const FUNCTIONS = new Set(['floor', 'ceil', 'round', 'abs', 'min', 'max']);

export type FormulaResult =
  { readonly ok: true; readonly formula: string } | { readonly ok: false; readonly reason: string };

/**
 * Translate a JavaScript damage formula. `variable(n)` gives the id of MZ
 * variable n. Fails (with a reason) on anything outside the shared subset.
 */
export function translateFormula(source: string, variable: (n: number) => string): FormulaResult {
  const js = source.trim().replace(/;\s*$/, '');
  if (js === '') return { ok: false, reason: 'the formula is empty' };
  if (js.includes(';')) return { ok: false, reason: 'it runs several statements' };
  let unknown: string | null = null;
  const out = js
    .replace(/===/g, '==')
    .replace(/!==/g, '!=')
    .replace(
      /\bMath\.randomInt\(\s*(\d+)\s*\)/g,
      (_m, n: string) => `random(0, ${Math.max(0, Number(n) - 1)})`,
    )
    .replace(/\bMath\.([A-Za-z]+)\b/g, (m, fn: string) => {
      if (FUNCTIONS.has(fn)) return fn;
      unknown ??= m;
      return m;
    })
    .replace(
      /\$gameVariables\.value\(\s*(\d+)\s*\)|\bv\[\s*(\d+)\s*\]/g,
      (_m, a?: string, b?: string) => {
        return `v["${variable(Number(a ?? b))}"]`;
      },
    )
    .replace(/\b([ab])\.([A-Za-z_]+)\b(\s*\()?/g, (m, who: string, key: string, call?: string) => {
      const mapped = SUBJECT_KEYS[key];
      if (call || !mapped) {
        unknown ??= `${who}.${key}${call ? '()' : ''}`;
        return m;
      }
      return `${who}.${mapped}`;
    });
  if (unknown)
    return { ok: false, reason: `it uses ${unknown}, which FreeQuest formulas don't have` };
  const problem = checkFormula(out);
  if (problem) return { ok: false, reason: problem };
  return { ok: true, formula: out };
}
