// Lenient reading of loosely shaped JSON: a value of the wrong type is
// replaced by a fallback instead of failing the whole import. Callers that
// care report the replacement themselves.

export type JsonRecord = Readonly<Record<string, unknown>>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** A whole number, or `fallback` for anything else (including NaN and fractions). */
export function asInt(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fallback;
}

/**
 * A list of names numbered from 1, as MZ stores its type lists, switches and
 * variables: position 0 is unused. Returns the names by number (index 0 is
 * always ''); anything that isn't a string becomes ''.
 */
export function numberedNames(value: unknown): readonly string[] {
  const list = asArray(value);
  return ['', ...list.slice(1).map((v) => asString(v).trim())];
}
