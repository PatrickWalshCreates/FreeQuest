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

/** Draw `top` over `bottom` (same size, or `top` centred on it), blending by alpha. */
export function layerOver(bottom: RgbaImage, top: RgbaImage): RgbaImage {
  const out = { width: bottom.width, height: bottom.height, data: new Uint8Array(bottom.data) };
  const ox = Math.round((bottom.width - top.width) / 2);
  const oy = Math.round((bottom.height - top.height) / 2);
  for (let y = 0; y < top.height; y++) {
    const ty = oy + y;
    if (ty < 0 || ty >= out.height) continue;
    for (let x = 0; x < top.width; x++) {
      const tx = ox + x;
      if (tx < 0 || tx >= out.width) continue;
      const s = (y * top.width + x) * 4;
      const d = (ty * out.width + tx) * 4;
      const a = (top.data[s + 3] ?? 0) / 255;
      if (a === 0) continue;
      const below = (out.data[d + 3] ?? 0) / 255;
      const alpha = a + below * (1 - a);
      for (let c = 0; c < 3; c++) {
        const mixed =
          ((top.data[s + c] ?? 0) * a + (out.data[d + c] ?? 0) * below * (1 - a)) / alpha;
        out.data[d + c] = Math.round(mixed);
      }
      out.data[d + 3] = Math.round(alpha * 255);
    }
  }
  return out;
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
