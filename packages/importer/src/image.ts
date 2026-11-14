// Pixels, without any image library: the importer composes tiles itself and
// leaves PNG decoding and encoding to an `ImageCodec` its caller supplies
// (pngjs in Node and tests, a canvas in the editor), so it stays pure.

/** 8-bit RGBA pixels, rows top to bottom. */
export interface RgbaImage {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export interface ImageCodec {
  decode(bytes: Uint8Array): Promise<RgbaImage>;
  encode(image: RgbaImage): Promise<Uint8Array>;
}

/** A transparent image. */
export function blankImage(width: number, height: number): RgbaImage {
  return { width, height, data: new Uint8Array(width * height * 4) };
}

/**
 * Copy a `w` × `h` area from `src` at (sx, sy) to `dst` at (dx, dy). Parts
 * outside either image are skipped (they stay transparent).
 */
export function copyArea(
  src: RgbaImage,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dst: RgbaImage,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < h; y++) {
    const fy = sy + y;
    const ty = dy + y;
    if (fy < 0 || fy >= src.height || ty < 0 || ty >= dst.height) continue;
    const x0 = Math.max(0, -sx, -dx);
    const x1 = Math.min(w, src.width - sx, dst.width - dx);
    if (x1 <= x0) continue;
    const from = (fy * src.width + sx + x0) * 4;
    dst.data.set(src.data.subarray(from, from + (x1 - x0) * 4), (ty * dst.width + dx + x0) * 4);
  }
}
