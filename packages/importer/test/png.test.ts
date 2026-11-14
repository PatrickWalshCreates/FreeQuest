import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { PngError, decodePng, encodePng } from '../src/index.js';
import { TINY } from './helpers.js';

const zlib = {
  inflate: async (d: Uint8Array) => new Uint8Array(inflateSync(d)),
  deflate: async (d: Uint8Array) => new Uint8Array(deflateSync(d)),
};

/** A PNG built by hand: any header, palette and raw scanlines (each row starts with filter 0). */
function handmade(options: {
  width: number;
  height: number;
  depth: number;
  color: number;
  interlace?: number;
  palette?: number[];
  trns?: number[];
  raw: number[];
}): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const chunk = (type: string, body: Uint8Array) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(type, 4, 'latin1');
    Buffer.from(body).copy(out, 8);
    let c = 0xffffffff;
    for (const b of out.subarray(4, 8 + body.length))
      c = (crcTable[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
    out.writeUInt32BE((c ^ 0xffffffff) >>> 0, 8 + body.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(options.width, 0);
  header.writeUInt32BE(options.height, 4);
  header.set([options.depth, options.color, 0, 0, options.interlace ?? 0], 8);
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', header),
      ...(options.palette ? [chunk('PLTE', new Uint8Array(options.palette))] : []),
      ...(options.trns ? [chunk('tRNS', new Uint8Array(options.trns))] : []),
      chunk('IDAT', deflateSync(Buffer.from(options.raw))),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

const pixels = (data: Uint8Array) => [...data];

describe('PNG reading and writing', () => {
  it('reads what pngjs reads, and writes what pngjs reads back exactly', async () => {
    for (const file of [
      'img/tilesets/Hollow_A2.png',
      'img/characters/Lamplighters.png',
      'img/system/Window.png',
    ]) {
      const bytes = new Uint8Array(await readFile(join(TINY, file)));
      const ours = await decodePng(bytes, zlib);
      const theirs = PNG.sync.read(Buffer.from(bytes));
      expect([ours.width, ours.height]).toEqual([theirs.width, theirs.height]);
      expect(Buffer.from(ours.data).equals(theirs.data)).toBe(true);
      const again = PNG.sync.read(Buffer.from(await encodePng(ours, zlib)));
      expect(Buffer.from(ours.data).equals(again.data)).toBe(true);
    }
  });

  it('keeps every pixel of an image with soft edges (no premultiplied rounding)', async () => {
    const data = new Uint8Array(16 * 4 * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37) % 256;
    const image = { width: 16, height: 4, data };
    expect(pixels((await decodePng(await encodePng(image, zlib), zlib)).data)).toEqual(
      pixels(data),
    );
  });

  it('reads palettes with low bit depths and transparency', async () => {
    // 2 bits per pixel, 3 × 2: indexes 0 1 2 / 3 0 1; colour 0 is see-through.
    const png = handmade({
      width: 3,
      height: 2,
      depth: 2,
      color: 3,
      palette: [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9],
      trns: [0],
      raw: [0, 0b00011000, 0, 0b11000100],
    });
    const image = await decodePng(png, zlib);
    expect(pixels(image.data)).toEqual([
      255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255, 9, 9, 9, 255, 255, 0, 0, 0, 0, 255, 0, 255,
    ]);
  });

  it('reads greyscale with a transparent key, 16-bit and interlaced images', async () => {
    const grey = await decodePng(
      handmade({ width: 2, height: 1, depth: 8, color: 0, trns: [0, 7], raw: [0, 7, 200] }),
      zlib,
    );
    expect(pixels(grey.data)).toEqual([7, 7, 7, 0, 200, 200, 200, 255]);
    const deep = await decodePng(
      handmade({
        width: 1,
        height: 1,
        depth: 16,
        color: 2,
        raw: [0, 0x12, 0x34, 0xab, 0xcd, 0xff, 0xff],
      }),
      zlib,
    );
    expect(pixels(deep.data)).toEqual([0x12, 0xab, 0xff, 255]);
    // Adam7, 2 × 2 greyscale: pass 1 has (0,0), pass 6 (1,0), pass 7 row 1 (0,1) (1,1).
    const interlaced = await decodePng(
      handmade({
        width: 2,
        height: 2,
        depth: 8,
        color: 0,
        interlace: 1,
        raw: [0, 10, 0, 20, 0, 30, 40],
      }),
      zlib,
    );
    expect(pixels(interlaced.data)).toEqual([
      10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255, 40, 40, 40, 255,
    ]);
  });

  it('refuses what isn’t a PNG', async () => {
    await expect(decodePng(new Uint8Array([1, 2, 3]), zlib)).rejects.toThrow(PngError);
  });
});
