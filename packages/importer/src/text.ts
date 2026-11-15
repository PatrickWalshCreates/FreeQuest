// MZ's backslash codes in messages and choices (\V[3], \N[1], \C[2], \.…) as
// FreeQuest's `{…}` text codes. Colour numbers name colours in the project's
// window skin, so `color(n)` supplies them. Codes FreeQuest has no match for
// (font sizes, the gold window) are dropped and named in `dropped`.

export interface TextContext {
  readonly variable: (n: number) => string;
  /** The actor's id, or null when there's no such actor. */
  readonly actor: (n: number) => string | null;
  /** MZ text colour n as #rrggbb (n ≥ 1). */
  readonly color: (n: number) => string;
}

export interface ConvertedText {
  readonly text: string;
  /** MZ codes that were left out, e.g. "\\." (each once). */
  readonly dropped: readonly string[];
}

/** MZ's pacing codes and FreeQuest's: a quarter-second pause, a second, a key, instant text. */
const PACING: Readonly<Record<string, string>> = {
  '.': '{wait:0.25}',
  '|': '{wait:1}',
  '!': '{key}',
  '>': '{instant}',
  '<': '{/instant}',
};

const DROPPED_NAMES: Readonly<Record<string, string>> = {
  '^': 'no wait at the end (\\^)',
  $: 'gold window (\\$)',
  '{': 'bigger text (\\{)',
  '}': 'smaller text (\\})',
};

export function convertText(source: string, ctx: TextContext): ConvertedText {
  const dropped = new Set<string>();
  let out = '';
  let colorOpen = false;
  const closeColor = () => {
    if (colorOpen) out += '{/color}';
    colorOpen = false;
  };
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? '';
    if (ch === '{') {
      out += '{{';
      continue;
    }
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = source[i + 1] ?? '';
    // \\ is a backslash.
    if (next === '\\') {
      out += '\\';
      i++;
      continue;
    }
    const pacing = PACING[next];
    if (pacing) {
      out += pacing;
      i++;
      continue;
    }
    const named = DROPPED_NAMES[next];
    if (named) {
      dropped.add(named);
      i++;
      continue;
    }
    // A letter code, maybe with [n]: \V[3], \G, \FS[24].
    const match = /^([A-Za-z]+)(?:\[([^\]]*)\])?/.exec(source.slice(i + 1));
    if (!match) {
      out += ch;
      continue;
    }
    i += match[0].length;
    const code = (match[1] ?? '').toUpperCase();
    const arg = match[2];
    const n = arg !== undefined && /^\d+$/.test(arg.trim()) ? Number(arg.trim()) : null;
    if (code === 'V' && n !== null) out += `{v:${ctx.variable(n)}}`;
    else if (code === 'N' && n !== null) {
      const actor = ctx.actor(n);
      if (actor) out += `{actor:${actor}}`;
      else dropped.add(`the name of missing actor ${n} (\\N[${n}])`);
    } else if (code === 'P' && n !== null && n > 0) out += `{member:${n}}`;
    else if (code === 'G') out += '{currency}';
    else if (code === 'I' && n !== null) out += `{icon:${n}}`;
    else if (code === 'C' && n !== null) {
      closeColor();
      if (n > 0) {
        out += `{color:${ctx.color(n)}}`;
        colorOpen = true;
      }
    } else dropped.add(`\\${match[0]}`);
  }
  closeColor();
  return { text: out, dropped: [...dropped] };
}

/** MZ text colours when the project has no window skin: our own fallback palette. */
export const FALLBACK_TEXT_COLORS: readonly string[] = [
  '#ffffff',
  '#74c0fc',
  '#ff6b6b',
  '#8ce99a',
  '#99e9f2',
  '#d0a2ff',
  '#ffd479',
  '#a8a8b4',
];
