// A small PNG reader and writer, so imports come out the same (and lossless)
// in the editor and the CLI. Compression is the platform's (zlib in Node,
// CompressionStream in browsers), passed in as `inflate` / `deflate`.
// Reads every standard kind: greyscale, RGB, palette, with alpha, 1–16 bits,
// interlaced or not. Writes 8-bit RGBA with a filter chosen per row.
import type { ImageCodec, RgbaImage } from './image.js';

export interface Zlib {
  /** zlib-wrapped inflate (RFC 1950), as PNG's image data uses. */
  inflate(data: Uint8Array): Promise<Uint8Array>;
  deflate(data: Uint8Array): Promise<Uint8Array>;
}

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export class PngError extends Error {
  override name = 'PngError';
}

export function pngCodec(zlib: Zlib): ImageCodec {
  return {
    decode: (bytes) => decodePng(bytes, zlib),
    encode: (image) => encodePng(image, zlib),
  };
}

// --- Reading ------------------------------------------------------------------

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export async function decodePng(bytes: Uint8Array, zlib: Zlib): Promise<RgbaImage> {
  if (bytes.length < 8 || SIGNATURE.some((b, i) => bytes[i] !== b))
    throw new PngError('Not a PNG file');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let depth = 0;
  let color = -1;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const data: Uint8Array[] = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8));
    const body = bytes.subarray(at + 8, at + 8 + length);
    at += 12 + length;
    if (type === 'IHDR') {
      const h = new DataView(body.buffer, body.byteOffset, body.byteLength);
      width = h.getUint32(0);
      height = h.getUint32(4);
      depth = body[8] ?? 0;
      color = body[9] ?? -1;
      interlace = body[12] ?? 0;
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') transparency = body;
    else if (type === 'IDAT') data.push(body);
    else if (type === 'IEND') break;
  }
  const channels = CHANNELS[color];
  if (!channels || width <= 0 || height <= 0 || ![1, 2, 4, 8, 16].includes(depth)) {
    throw new PngError('Unsupported PNG layout');
  }
  if (color === 3 && !palette) throw new PngError('PNG palette missing');
  const raw = await zlib.inflate(concat(data));
  const out = new Uint8Array(width * height * 4);
  const bitsPerPixel = channels * depth;
  const bpp = Math.max(1, bitsPerPixel >> 3);

  // Each pass is a sub-image (Adam7 has seven, a plain image one).
  const passes = interlace === 1 ? ADAM7 : [[0, 0, 1, 1]];
  let offset = 0;
  for (const [x0 = 0, y0 = 0, dx = 1, dy = 1] of passes) {
    const pw = Math.ceil((width - x0) / dx);
    const ph = Math.ceil((height - y0) / dy);
    if (pw <= 0 || ph <= 0) continue;
    const stride = Math.ceil((pw * bitsPerPixel) / 8);
    let previous = new Uint8Array(stride);
    for (let row = 0; row < ph; row++) {
      const filter = raw[offset] ?? 0;
      const line = raw.slice(offset + 1, offset + 1 + stride);
      offset += 1 + stride;
      unfilter(filter, line, previous, bpp);
      previous = line;
      for (let col = 0; col < pw; col++) {
        const px = ((y0 + row * dy) * width + x0 + col * dx) * 4;
        writePixel(out, px, line, col, color, depth, channels, palette, transparency);
      }
    }
  }
  return { width, height, data: out };
}

const ADAM7: readonly (readonly number[])[] = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
];

function unfilter(filter: number, line: Uint8Array, prev: Uint8Array, bpp: number): void {
  for (let i = 0; i < line.length; i++) {
    const a = i >= bpp ? (line[i - bpp] ?? 0) : 0;
    const b = prev[i] ?? 0;
    const c = i >= bpp ? (prev[i - bpp] ?? 0) : 0;
    const x = line[i] ?? 0;
    if (filter === 1) line[i] = x + a;
    else if (filter === 2) line[i] = x + b;
    else if (filter === 3) line[i] = x + ((a + b) >> 1);
    else if (filter === 4) line[i] = x + paeth(a, b, c);
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Sample `i` of a line (any bit depth), scaled to 8 bits. */
function sample(line: Uint8Array, i: number, depth: number): number {
  if (depth === 8) return line[i] ?? 0;
  if (depth === 16) return line[i * 2] ?? 0;
  const perByte = 8 / depth;
  const byte = line[Math.floor(i / perByte)] ?? 0;
  const shift = 8 - depth * ((i % perByte) + 1);
  const value = (byte >> shift) & ((1 << depth) - 1);
  return Math.round((value * 255) / ((1 << depth) - 1));
}

/** The raw (unscaled) sample, for palette indexes and transparency keys. */
function rawSample(line: Uint8Array, i: number, depth: number): number {
  if (depth === 8) return line[i] ?? 0;
  if (depth === 16) return ((line[i * 2] ?? 0) << 8) | (line[i * 2 + 1] ?? 0);
  const perByte = 8 / depth;
  const byte = line[Math.floor(i / perByte)] ?? 0;
  return (byte >> (8 - depth * ((i % perByte) + 1))) & ((1 << depth) - 1);
}

function writePixel(
  out: Uint8Array,
  px: number,
  line: Uint8Array,
  col: number,
  color: number,
  depth: number,
  channels: number,
  palette: Uint8Array | null,
  trns: Uint8Array | null,
): void {
  const at = col * channels;
  let r: number;
  let g: number;
  let b: number;
  let a = 255;
  if (color === 3) {
    const index = rawSample(line, at, depth);
    r = palette?.[index * 3] ?? 0;
    g = palette?.[index * 3 + 1] ?? 0;
    b = palette?.[index * 3 + 2] ?? 0;
    a = trns && index < trns.length ? (trns[index] ?? 255) : 255;
  } else if (color === 0 || color === 4) {
    r = g = b = sample(line, at, depth);
    if (color === 4) a = sample(line, at + 1, depth);
    else if (
      trns &&
      trns.length >= 2 &&
      rawSample(line, at, depth) === (((trns[0] ?? 0) << 8) | (trns[1] ?? 0))
    )
      a = 0;
  } else {
    r = sample(line, at, depth);
    g = sample(line, at + 1, depth);
    b = sample(line, at + 2, depth);
    if (color === 6) a = sample(line, at + 3, depth);
    else if (trns && trns.length >= 6) {
      const key = (k: number) => ((trns[k] ?? 0) << 8) | (trns[k + 1] ?? 0);
      if (
        rawSample(line, at, depth) === key(0) &&
        rawSample(line, at + 1, depth) === key(2) &&
        rawSample(line, at + 2, depth) === key(4)
      )
        a = 0;
    }
  }
  out[px] = r;
  out[px + 1] = g;
  out[px + 2] = b;
  out[px + 3] = a;
}

// --- Writing ------------------------------------------------------------------

export async function encodePng(image: RgbaImage, zlib: Zlib): Promise<Uint8Array> {
  const { width, height, data } = image;
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    // Pick the filter whose output has the smallest sum (the usual heuristic).
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const out = candidates[f] ?? new Uint8Array(stride);
      let score = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? (line[i - 4] ?? 0) : 0;
        const b = prev[i] ?? 0;
        const c = i >= 4 ? (prev[i - 4] ?? 0) : 0;
        const x = line[i] ?? 0;
        const v =
          f === 0
            ? x
            : f === 1
              ? x - a
              : f === 2
                ? x - b
                : f === 3
                  ? x - ((a + b) >> 1)
                  : x - paeth(a, b, c);
        const byte = v & 0xff;
        out[i] = byte;
        score += byte < 128 ? byte : 256 - byte;
      }
      if (score < bestScore) [best, bestScore] = [f, score];
    }
    raw[y * (stride + 1)] = best;
    raw.set(candidates[best] ?? new Uint8Array(stride), y * (stride + 1) + 1);
    prev = new Uint8Array(line);
  }
  const header = new Uint8Array(13);
  const h = new DataView(header.buffer);
  h.setUint32(0, width);
  h.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  return concat([
    new Uint8Array(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', await zlib.deflate(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
