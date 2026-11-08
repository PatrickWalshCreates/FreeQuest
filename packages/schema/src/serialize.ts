/** Keys that always come first, in this order: what a thing is. */
const LEADING_KEYS = ['formatVersion', 'id', 'type', 'name', 'label'];
/** Keys that always come last, in this order: large nested blocks, so the small fields stay visible. */
const TRAILING_KEYS = [
  'tiles',
  'layers',
  'events',
  'pages',
  'options',
  'commands',
  'then',
  'else',
  'data',
];

/** Leading keys rank below 0, trailing keys above 0, everything else 0 (then alphabetical). */
function rank(key: string): number {
  const lead = LEADING_KEYS.indexOf(key);
  if (lead !== -1) return lead - LEADING_KEYS.length;
  const trail = TRAILING_KEYS.indexOf(key);
  return trail === -1 ? 0 : trail + 1;
}

const INTEGER_KEY = /^(?:0|-?[1-9][0-9]*)$/;

/** Integer keys (e.g. level curves) sort numerically, so "5" comes before "10". */
function compareKeys(a: string, b: string): number {
  const byRank = rank(a) - rank(b);
  if (byRank !== 0) return byRank;
  if (INTEGER_KEY.test(a) && INTEGER_KEY.test(b)) return Number(a) - Number(b);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPrimitive(value: unknown): boolean {
  return value === null || typeof value !== 'object';
}

function write(value: unknown, indent: string): string {
  if (isPrimitive(value)) {
    return JSON.stringify(value) ?? 'null';
  }
  const inner = indent + '  ';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    // Arrays of primitives (e.g. one row of tiles) stay on one line so that
    // editing a tile changes exactly one line of the diff.
    if (value.every(isPrimitive)) {
      return '[' + value.map((v) => write(v, inner)).join(', ') + ']';
    }
    return '[\n' + value.map((v) => inner + write(v, inner)).join(',\n') + '\n' + indent + ']';
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => compareKeys(a, b));
  if (entries.length === 0) return '{}';
  return (
    '{\n' +
    entries.map(([k, v]) => inner + JSON.stringify(k) + ': ' + write(v, inner)).join(',\n') +
    '\n' +
    indent +
    '}'
  );
}

/**
 * Serialize project data deterministically: fixed key order (leading keys,
 * then alphabetical, then trailing blocks), two-space indent,
 * primitive arrays inline, trailing newline. Every tool that writes project
 * files must use this so diffs stay clean.
 */
export function stableStringify(value: unknown): string {
  return write(value, '') + '\n';
}
