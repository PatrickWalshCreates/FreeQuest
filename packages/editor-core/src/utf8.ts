// UTF-8 without TextEncoder/TextDecoder: editor-core only assumes plain
// ES2023 (no DOM or Node globals), like core.

/** Encode a string as UTF-8 bytes. */
export function encodeUtf8(text: string): Uint8Array {
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return Uint8Array.from(bytes);
}

/** Decode UTF-8 bytes (invalid sequences become U+FFFD). */
export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i] ?? 0;
    const need = b < 0x80 ? 0 : b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : -1;
    const truncated = i + need >= bytes.length;
    if (need < 0 || (need > 0 && truncated)) {
      out += '\ufffd';
      i += 1;
      continue;
    }
    let code = need === 0 ? b : b & (0x3f >> need);
    for (let k = 1; k <= need; k++) code = (code << 6) | ((bytes[i + k] ?? 0) & 0x3f);
    out += String.fromCodePoint(code);
    i += need + 1;
  }
  return out;
}

/** Bytes a string takes as UTF-8. */
export function utf8Length(text: string): number {
  let length = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}
