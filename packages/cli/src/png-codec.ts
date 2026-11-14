// PNG decoding and encoding for the importer, through pngjs (Node only).
import type { ImageCodec } from '@freequest/importer';
import { PNG } from 'pngjs';

export const pngCodec: ImageCodec = {
  async decode(bytes) {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { width: png.width, height: png.height, data: new Uint8Array(png.data) };
  },
  async encode(image) {
    const png = new PNG({ width: image.width, height: image.height });
    png.data = Buffer.from(image.data);
    return new Uint8Array(PNG.sync.write(png));
  },
};
