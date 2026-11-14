// PNGs for the importer in the editor: the importer's own codec (lossless,
// unlike a canvas round trip), with the browser's zlib streams.
import { type ImageCodec, pngCodec as makeCodec } from '@freequest/importer';

async function run(
  data: Uint8Array,
  stream: CompressionStream | DecompressionStream,
): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const pngCodec: ImageCodec = makeCodec({
  inflate: (data) => run(data, new DecompressionStream('deflate')),
  deflate: (data) => run(data, new CompressionStream('deflate')),
});
