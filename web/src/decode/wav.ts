/* RIFF/WAVE reader. Mirrors what ffmpeg 7.1 (riffdec.c, wavdec.c,
   pcm decoders) reports and decodes for PCM 16/24/32-bit integer and
   32/64-bit float, including WAVE_FORMAT_EXTENSIBLE. */

import type { ProbeInfo, SampleFormat, StreamFormat } from "../analysis/types";
import { UnsupportedFileError, type ReadRange } from "./source";

type PcmKind = "s16" | "s24" | "s32" | "f32" | "f64";

export interface WavInfo {
  probe: ProbeInfo;
  stream: StreamFormat;
  kind: PcmKind;
  dataOffset: number;
  /** Bytes of sample data to decode. */
  dataBytes: number;
}

const CODEC: Record<PcmKind, string> = {
  s16: "pcm_s16le", s24: "pcm_s24le", s32: "pcm_s32le", f32: "pcm_f32le", f64: "pcm_f64le",
};
const BYTES: Record<PcmKind, number> = { s16: 2, s24: 3, s32: 4, f32: 4, f64: 8 };
const FORMAT: Record<PcmKind, SampleFormat> = { s16: "s16", s24: "s32", s32: "s32", f32: "flt", f64: "dbl" };

// WAV dwChannelMask bits that ebur128 weights differently.
const LFE = 0x8;
const BACK = 0x10 | 0x20 | 0x100 | 0x200 | 0x400 | 0x8000 | 0x10000 | 0x20000;

const tag = (b: Uint8Array, o: number): string => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

export async function readWavHeader(read: ReadRange, fileSize: number): Promise<WavInfo> {
  const head = await read(0, Math.min(12, fileSize));
  if (head.length < 12 || tag(head, 8) !== "WAVE") throw new UnsupportedFileError("This is not a WAV file.");
  const riff = tag(head, 0);
  if (riff !== "RIFF") {
    throw new UnsupportedFileError(riff === "RF64" || riff === "BW64"
      ? "RF64 WAV files are not supported yet."
      : "This is not a WAV file.");
  }

  let fmt: DataView | null = null;
  let fmtSize = 0;
  let off = 12;
  while (off + 8 <= fileSize) {
    const hdr = await read(off, off + 8);
    if (hdr.length < 8) break;
    const id = tag(hdr, 0);
    const size = new DataView(hdr.buffer, hdr.byteOffset, 8).getUint32(4, true);
    if (id === "fmt ") {
      const body = await read(off + 8, off + 8 + Math.min(size, 64));
      fmt = new DataView(body.buffer, body.byteOffset, body.length);
      fmtSize = size;
    } else if (id === "data") {
      if (!fmt) throw new UnsupportedFileError("This WAV file has no format chunk before its audio.");
      return describe(fmt, fmtSize, off + 8, size, fileSize);
    }
    off += 8 + size + (size & 1);
  }
  throw new UnsupportedFileError("This WAV file has no audio data.");
}

function describe(fmt: DataView, fmtSize: number, dataOffset: number, dataSize: number, fileSize: number): WavInfo {
  if (fmtSize < 14 || fmt.byteLength < 14) throw new UnsupportedFileError("This WAV file has a damaged format chunk.");
  let formatTag = fmt.getUint16(0, true);
  const channels = fmt.getUint16(2, true);
  const sampleRate = fmt.getUint32(4, true);
  const byteRate = fmt.getUint32(8, true);
  const bits = fmtSize === 14 ? 8 : fmt.getUint16(14, true);
  let mask = 0;
  if (formatTag === 0xfffe) {
    if (fmtSize >= 40 && fmt.byteLength >= 40 && fmt.getUint16(16, true) >= 22) {
      mask = fmt.getUint32(20, true);
      formatTag = fmt.getUint32(24, true); // first field of the SubFormat GUID
    } else {
      formatTag = 0;
    }
  }

  let kind: PcmKind | null = null;
  if (formatTag === 1) {
    const bytes = (bits + 7) >> 3;
    kind = bytes === 2 ? "s16" : bytes === 3 ? "s24" : bytes === 4 ? "s32" : null;
  } else if (formatTag === 3) {
    kind = bits === 32 ? "f32" : bits === 64 ? "f64" : null;
  }
  if (!kind) {
    throw new UnsupportedFileError(
      "This WAV encoding is not supported. Use 16, 24, or 32-bit PCM, or 32 or 64-bit float.");
  }
  if (channels !== 1 && channels !== 2) {
    throw new UnsupportedFileError(
      `This file has ${channels} channels. Spec Check reads mono and stereo files.`);
  }
  if (sampleRate <= 0) throw new UnsupportedFileError("This WAV file has an invalid sample rate.");

  // ffmpeg reads to data_end, or to end of file for an unknown size.
  const known = dataSize > 0 && dataSize !== 0xffffffff;
  const available = fileSize - dataOffset;
  const dataBytes = Math.max(0, known ? Math.min(dataSize, available) : available);

  // ffprobe: bit_rate is the header's byte rate * 8; duration counts whole
  // sample frames in the declared data size when the file holds all of it,
  // otherwise it is estimated from the bit rate.
  const bitRate = byteRate * 8;
  const frameBits = channels * BYTES[kind] * 8;
  let duration: number | null = null;
  if (known && dataOffset + dataSize <= fileSize) {
    duration = Math.floor((dataSize * 8) / frameBits) / sampleRate;
  } else if (bitRate > 0) {
    duration = (available * 8) / bitRate;
  }

  return {
    kind,
    dataOffset,
    dataBytes,
    probe: {
      codec: CODEC[kind],
      sampleRateHz: sampleRate,
      channels,
      bitrateKbps: bitRate > 0 ? Math.round(bitRate / 1000) : null,
      duration: duration === null ? null : parseFloat(duration.toFixed(6)),
    },
    stream: {
      sampleRate,
      channels,
      sampleFormat: FORMAT[kind],
      weights: channelWeights(channels, mask),
    },
  };
}

function channelWeights(channels: number, mask: number): number[] {
  // ffmpeg uses the extensible mask only when it names exactly `channels`
  // speakers; otherwise the default mono/stereo layout (weight 1.0).
  const bits: number[] = [];
  for (let b = 0; b < 32; b++) if (mask & (1 << b)) bits.push(1 << b);
  if (bits.length !== channels) return new Array<number>(channels).fill(1);
  return bits.map((b) => (b & LFE ? 0 : b & BACK ? 1.41 : 1));
}

/** Converts little-endian PCM bytes to interleaved raw values, carrying
    any partial sample frame over to the next chunk. */
export class PcmDecoder {
  private readonly kind: PcmKind;
  private readonly frameBytes: number;
  private carry = new Uint8Array(0);

  constructor(info: WavInfo) {
    this.kind = info.kind;
    this.frameBytes = BYTES[info.kind] * info.stream.channels;
  }

  decode(chunk: Uint8Array): { data: Float64Array; frames: number } {
    let bytes = chunk;
    if (this.carry.length) {
      bytes = new Uint8Array(this.carry.length + chunk.length);
      bytes.set(this.carry);
      bytes.set(chunk, this.carry.length);
    }
    const frames = Math.floor(bytes.length / this.frameBytes);
    const used = frames * this.frameBytes;
    this.carry = bytes.slice(used);
    const view = new DataView(bytes.buffer, bytes.byteOffset, used);
    const n = used / BYTES[this.kind];
    const out = new Float64Array(n);
    switch (this.kind) {
      case "s16":
        for (let i = 0; i < n; i++) out[i] = view.getInt16(i * 2, true);
        break;
      case "s24":
        for (let i = 0, o = 0; i < n; i++, o += 3) {
          // pcm_s24le decodes to s32 as (sample << 8)
          out[i] = (bytes[o] << 8) | (bytes[o + 1] << 16) | (bytes[o + 2] << 24);
        }
        break;
      case "s32":
        for (let i = 0; i < n; i++) out[i] = view.getInt32(i * 4, true);
        break;
      case "f32":
        for (let i = 0; i < n; i++) out[i] = view.getFloat32(i * 4, true);
        break;
      case "f64":
        for (let i = 0; i < n; i++) out[i] = view.getFloat64(i * 8, true);
        break;
    }
    return { data: out, frames };
  }
}
