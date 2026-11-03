/* MP3 probing as ffmpeg 7.1 libavformat/mp3dec.c reports it, and
   streaming decode with mpg123 (WASM). mpg123's gapless mode trims the
   LAME encoder delay and padding exactly as ffmpeg does, so the decoded
   stream lines up sample for sample with ffmpeg's. */

import { MPEGDecoder } from "mpg123-decoder";
import type { ProbeInfo, StreamFormat } from "../analysis/types";
import { UnsupportedFileError, type ReadRange } from "./source";

export interface Mp3Info {
  probe: ProbeInfo;
  stream: StreamFormat;
}

interface FrameHeader {
  lsf: boolean;
  layer: number;
  sampleRate: number;
  bitRate: number;
  channels: number;
  frameSize: number;
}

const BITRATES = [
  // MPEG-1 layer III, MPEG-2/2.5 layer III (kbps)
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
];

function decodeHeader(h: number): FrameHeader | null {
  if ((h & 0xffe00000) >>> 0 !== 0xffe00000) return null;
  const version = (h >>> 19) & 3;
  const layerBits = (h >>> 17) & 3;
  const brIndex = (h >>> 12) & 15;
  const srIndex = (h >>> 10) & 3;
  if (version === 1 || layerBits === 0 || brIndex === 15 || srIndex === 3) return null;
  const lsf = version !== 3;
  const mpeg25 = version === 0;
  const layer = 4 - layerBits;
  const sampleRate = [44100, 48000, 32000][srIndex] >> ((lsf ? 1 : 0) + (mpeg25 ? 1 : 0));
  const padding = (h >>> 9) & 1;
  const channels = ((h >>> 6) & 3) === 3 ? 1 : 2;
  const kbps = layer === 3 ? BITRATES[lsf ? 1 : 0][brIndex] : 0;
  const frameSize = kbps ? Math.floor((kbps * 144000) / (sampleRate << (lsf ? 1 : 0))) + padding : 0;
  return { lsf, layer, sampleRate, bitRate: kbps * 1000, channels, frameSize };
}

/** Offset of the first byte after the ID3v2 tag(s) at the start of the
    file (ff_id3v2_match / id3v2_read_internal). */
export async function skipId3v2(read: ReadRange, fileSize: number): Promise<number> {
  let off = 0;
  while (off + 10 <= fileSize) {
    const t = await read(off, off + 10);
    if (t.length < 10 || t[0] !== 0x49 || t[1] !== 0x44 || t[2] !== 0x33 || t[3] === 0xff ||
        t[4] === 0xff || (t[6] | t[7] | t[8] | t[9]) & 0x80) {
      break;
    }
    const size = (t[6] << 21) | (t[7] << 14) | (t[8] << 7) | t[9];
    off += 10 + size + (t[5] & 0x10 ? 10 : 0);
  }
  return off;
}

/** Probe from the bytes at file offset `base` (just after any ID3v2 tag);
    `head` should cover the first frame. */
export function probeMp3(head: Uint8Array, base: number, fileSize: number): Mp3Info {
  if (head.length < 4) throw new UnsupportedFileError("This MP3 file has no audio frames.");
  const dv = new DataView(head.buffer, head.byteOffset, head.length);
  const first = decodeHeader(dv.getUint32(0));
  if (!first) throw new UnsupportedFileError("This is not an MP3 file Spec Check can read.");
  if (first.layer !== 3) throw new UnsupportedFileError("Only MPEG layer III (MP3) audio is supported.");

  // Xing / Info tag inside the first frame (mp3_parse_info_tag).
  const u32 = (o: number): number => (o + 4 <= head.length ? dv.getUint32(o) : 0);
  let frames = 0;
  let headerFileSize = 0;
  let p = 4 + (first.lsf ? (first.channels === 1 ? 9 : 17) : first.channels === 1 ? 17 : 32);
  const tagId = u32(p);
  const isCbr = tagId === 0x496e666f; // "Info"
  if (tagId === 0x58696e67 || isCbr) { // "Xing" / "Info"
    const flags = u32(p + 4);
    p += 8;
    if (flags & 1) { frames = u32(p); p += 4; }
    if (flags & 2) headerFileSize = u32(p);
    const fsize = Math.max(0, fileSize - (base + 4));
    if (fsize && headerFileSize) {
      const min = Math.min(fsize, headerFileSize);
      const delta = Math.max(fsize, headerFileSize) - min;
      if (fsize > headerFileSize && delta > Math.floor(min / 16)) frames = 0; // concatenated file
    }
  }
  // VBRI (Fraunhofer) tag, 32 bytes after the frame header.
  const v = 4 + 32;
  if (u32(v) === 0x56425249 && v + 18 <= head.length && dv.getUint16(v + 4) === 1) {
    headerFileSize = u32(v + 10);
    frames = u32(v + 14);
  }

  const spf = first.lsf ? 576 : 1152;
  const sr = first.sampleRate;
  const hasTag = frames > 0 || headerFileSize > 0;

  // ffprobe: duration from the Xing/VBRI frame count (it includes encoder
  // delay and padding); otherwise estimated from the first frame's bit rate.
  let duration: number | null = null;
  if (frames) {
    duration = (frames * spf) / sr;
  } else if (first.bitRate) {
    const dataOffset = hasTag ? base + first.frameSize : base;
    duration = ((fileSize - dataOffset) * 8) / first.bitRate;
  }
  // Stream bit_rate: Xing bytes / frames for VBR, the frame header for CBR.
  let bitRate = first.bitRate;
  if (headerFileSize && frames && !isCbr) {
    const den = frames * spf;
    bitRate = Math.floor((headerFileSize * 8 * sr + Math.floor(den / 2)) / den);
  }

  return {
    probe: {
      codec: "mp3",
      sampleRateHz: sr,
      channels: first.channels,
      bitrateKbps: bitRate ? Math.round(bitRate / 1000) : null,
      duration: duration === null ? null : parseFloat(duration.toFixed(6)),
    },
    stream: {
      sampleRate: sr,
      channels: first.channels,
      sampleFormat: "flt",
      weights: new Array<number>(first.channels).fill(1),
    },
  };
}

/** Streaming MP3 decoder producing interleaved float samples. */
export class Mp3Decoder {
  private readonly channels: number;
  private decoder: MPEGDecoder | null = null;

  constructor(channels: number) {
    this.channels = channels;
  }

  async init(): Promise<void> {
    this.decoder = new MPEGDecoder();
    await this.decoder.ready;
  }

  decode(chunk: Uint8Array): { data: Float64Array; frames: number } {
    if (!this.decoder) throw new Error("decoder not initialized");
    const r = this.decoder.decode(chunk);
    const frames = r.samplesDecoded;
    const ch = this.channels;
    const out = new Float64Array(frames * ch);
    // mpg123 is run with FORCE_STEREO; a mono stream comes back duplicated.
    const L = r.channelData[0];
    if (ch === 1) {
      for (let i = 0; i < frames; i++) out[i] = L[i];
    } else {
      const R = r.channelData[1];
      for (let i = 0, k = 0; i < frames; i++, k += 2) {
        out[k] = L[i];
        out[k + 1] = R[i];
      }
    }
    return { data: out, frames };
  }

  free(): void {
    this.decoder?.free();
    this.decoder = null;
  }
}
