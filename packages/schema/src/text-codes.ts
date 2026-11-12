// Text codes: FreeQuest's own `{…}` codes inside message text, speakers and
// choice labels, e.g. "{actor:hero} found {v:coins} {currency}!" or
// "{color:red}Danger{/color}". This file is the grammar and its checks (shared
// by the editor, the CLI and the game); core turns codes into styled runs.

/** Named text colours (the game also takes #rrggbb). Drawn by the runtime's theme. */
export const TEXT_COLORS = [
  'white',
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
] as const;
export type TextColorName = (typeof TEXT_COLORS)[number];

/** What each code needs after its colon: an id, a number, a colour, or nothing. */
const CODES = {
  v: 'id',
  actor: 'id',
  member: 'position',
  gold: 'none',
  currency: 'none',
  item: 'id',
  equipment: 'id',
  color: 'color',
  '/color': 'none',
  icon: 'index',
} as const;
export type TextCodeName = keyof typeof CODES;

/** The codes, for help text: `{v:id}`, `{gold}`… */
export const TEXT_CODE_HELP: readonly { readonly code: string; readonly shows: string }[] = [
  { code: '{v:id}', shows: 'a variable’s value' },
  { code: '{actor:id}', shows: 'an actor’s name' },
  { code: '{member:1}', shows: 'the name of the party’s 1st (2nd…) member' },
  { code: '{gold}', shows: 'the party’s gold' },
  { code: '{currency}', shows: 'the currency, e.g. G' },
  { code: '{item:id}', shows: 'an item’s name ({equipment:id} for equipment)' },
  { code: '{color:red}…{/color}', shows: `coloured text (${TEXT_COLORS.join(', ')} or #rrggbb)` },
  { code: '{icon:3}', shows: 'an icon from the iconset' },
  { code: '{{', shows: 'a { on its own' },
];

export type TextToken =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'code'; readonly name: TextCodeName; readonly arg: string | null };

export interface ParsedText {
  readonly tokens: readonly TextToken[];
  /** Readable problems; codes with problems are left out of `tokens`. */
  readonly problems: readonly string[];
}

const ID = /^[a-z0-9][a-z0-9_-]*$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

/** A colour a `{color:…}` code accepts. */
export function isTextColor(value: string): boolean {
  return HEX.test(value) || (TEXT_COLORS as readonly string[]).includes(value);
}

/** Split text into plain text and codes, reporting codes it can't use. */
export function parseTextCodes(source: string): ParsedText {
  const tokens: TextToken[] = [];
  const problems: string[] = [];
  let text = '';
  const flush = () => {
    if (text) tokens.push({ kind: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < source.length) {
    const ch = source[i] ?? '';
    if (ch !== '{') {
      text += ch;
      i++;
      continue;
    }
    if (source[i + 1] === '{') {
      text += '{';
      i += 2;
      continue;
    }
    const end = source.indexOf('}', i);
    if (end < 0) {
      problems.push(`"{" at ${i + 1} is never closed (write {{ for a { on its own)`);
      text += source.slice(i);
      break;
    }
    const body = source.slice(i + 1, end).trim();
    i = end + 1;
    const colon = body.indexOf(':');
    const name = (colon < 0 ? body : body.slice(0, colon)).trim();
    const arg = colon < 0 ? null : body.slice(colon + 1).trim();
    const wants = (CODES as Record<string, (typeof CODES)[TextCodeName]>)[name];
    const problem = !wants
      ? `unknown code {${body}}`
      : wants === 'none'
        ? arg !== null
          ? `{${name}} takes nothing after it`
          : null
        : arg === null || arg === ''
          ? `{${name}:…} needs ${wants === 'id' ? 'an id' : wants === 'color' ? 'a colour' : 'a number'}`
          : wants === 'id' && !ID.test(arg)
            ? `{${body}}: "${arg}" isn't an id`
            : wants === 'color' && !isTextColor(arg)
              ? `{${body}}: unknown colour "${arg}" (use ${TEXT_COLORS.join(', ')} or #rrggbb)`
              : wants === 'position' && !/^[1-9][0-9]*$/.test(arg)
                ? `{${body}}: the position is a number from 1`
                : wants === 'index' && !/^[0-9]+$/.test(arg)
                  ? `{${body}}: the icon is a number from 0`
                  : null;
    if (problem) {
      problems.push(problem);
      continue;
    }
    flush();
    tokens.push({ kind: 'code', name: name as TextCodeName, arg });
  }
  flush();
  return { tokens, problems };
}

/** The ids a text refers to, by kind, for reference checks. */
export function textCodeReferences(source: string): {
  readonly variables: string[];
  readonly actors: string[];
  readonly items: string[];
  readonly equipment: string[];
} {
  const refs = { variables: [] as string[], actors: [] as string[], items: [] as string[] };
  const equipment: string[] = [];
  for (const token of parseTextCodes(source).tokens) {
    if (token.kind !== 'code' || token.arg === null) continue;
    if (token.name === 'v') refs.variables.push(token.arg);
    else if (token.name === 'actor') refs.actors.push(token.arg);
    else if (token.name === 'item') refs.items.push(token.arg);
    else if (token.name === 'equipment') equipment.push(token.arg);
  }
  return { ...refs, equipment };
}
