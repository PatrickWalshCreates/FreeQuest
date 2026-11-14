// PNG decoding and encoding for the importer: its own codec, with Node's zlib.
import { promisify } from 'node:util';
import { deflate, inflate } from 'node:zlib';
import { type ImageCodec, pngCodec as makeCodec } from '@freequest/importer';

const inflateAsync = promisify(inflate);
const deflateAsync = promisify(deflate);

export const pngCodec: ImageCodec = makeCodec({
  inflate: async (data) => new Uint8Array(await inflateAsync(data)),
  deflate: async (data) => new Uint8Array(await deflateAsync(data, { level: 9 })),
});
