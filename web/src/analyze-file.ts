/* Reads a WAV or MP3 in chunks, decodes it, and runs the analyzer.
   Shared by the browser worker and the Node tests. */

import { Analyzer } from "./analysis/analyzer";
import type { Metrics } from "./analysis/types";
import { Mp3Decoder, probeMp3, skipId3v2 } from "./decode/mp3";
import { UnsupportedFileError, type ReadRange } from "./decode/source";
import { PcmDecoder, readWavHeader } from "./decode/wav";

export interface AnalyzeOptions {
  /** Bytes read per step. */
  chunkBytes?: number;
  /** Fraction of the file read so far, 0 to 1. */
  onProgress?: (fraction: number) => void;
}

const DEFAULT_CHUNK = 1 << 20;

export async function analyzeFile(read: ReadRange, fileSize: number, opts: AnalyzeOptions = {}): Promise<Metrics> {
  const chunk = opts.chunkBytes ?? DEFAULT_CHUNK;
  const progress = opts.onProgress ?? (() => {});
  if (fileSize < 12) throw new UnsupportedFileError("This file is too short to be a WAV or MP3.");
  const magic = await read(0, 12);
  const id = String.fromCharCode(...magic.subarray(0, 4));

  if (["RIFF", "RF64", "BW64"].includes(id)) {
    const info = await readWavHeader(read, fileSize);
    const pcm = new PcmDecoder(info);
    const analyzer = new Analyzer(info.stream);
    const end = info.dataOffset + info.dataBytes;
    for (let pos = info.dataOffset; pos < end; pos += chunk) {
      const bytes = await read(pos, Math.min(pos + chunk, end));
      const { data, frames } = pcm.decode(bytes);
      analyzer.push(data, frames);
      progress((Math.min(pos + chunk, end) - info.dataOffset) / Math.max(1, info.dataBytes));
    }
    return analyzer.finish(info.probe);
  }

  const looksMp3 = (magic[0] === 0x49 && magic[1] === 0x44 && magic[2] === 0x33) ||
    (magic[0] === 0xff && (magic[1] & 0xe0) === 0xe0);
  if (!looksMp3) throw new UnsupportedFileError("Spec Check reads WAV and MP3 files.");

  const base = await skipId3v2(read, fileSize);
  const info = probeMp3(await read(base, Math.min(base + 4096, fileSize)), base, fileSize);
  const dec = new Mp3Decoder(info.stream.channels);
  await dec.init();
  try {
    const analyzer = new Analyzer(info.stream);
    for (let pos = 0; pos < fileSize; pos += chunk) {
      const { data, frames } = dec.decode(await read(pos, Math.min(pos + chunk, fileSize)));
      analyzer.push(data, frames);
      progress(Math.min(pos + chunk, fileSize) / fileSize);
    }
    return analyzer.finish(info.probe);
  } finally {
    dec.free();
  }
}
