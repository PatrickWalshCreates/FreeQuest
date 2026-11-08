/** Keys that always come first, in this order. Everything else is sorted alphabetically. */
const LEADING_KEYS = ['formatVersion', 'id', 'name'];

function compareKeys(a: string, b: string): number {
  const ia = LEADING_KEYS.indexOf(a);
  const ib = LEADING_KEYS.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  }
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
 * Serialize project data deterministically: fixed key order, two-space indent,
 * primitive arrays inline, trailing newline. Every tool that writes project
 * files must use this so diffs stay clean.
 */
export function stableStringify(value: unknown): string {
  return write(value, '') + '\n';
}
