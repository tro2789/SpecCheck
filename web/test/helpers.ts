import fs from "node:fs";
import type { Metrics } from "../src/analysis/types";
import type { ReadRange } from "../src/decode/source";

export const FIXTURES = new URL("./fixtures/", import.meta.url);

export interface ReferenceFile {
  ffmpeg: string;
  fixtures: { file: string; metrics: Metrics & { codec: string } }[];
}

export function loadReference(): ReferenceFile {
  return JSON.parse(fs.readFileSync(new URL("reference.json", FIXTURES), "utf8")) as ReferenceFile;
}

/** File reader over a fixture, like File.slice() in the worker. */
export function fixtureReader(name: string): { read: ReadRange; size: number; close: () => void } {
  const fd = fs.openSync(new URL(name, FIXTURES), "r");
  const size = fs.fstatSync(fd).size;
  const read: ReadRange = async (start, end) => {
    const n = Math.max(0, Math.min(end, size) - start);
    const buf = Buffer.alloc(n);
    fs.readSync(fd, buf, 0, n, start);
    return new Uint8Array(buf.buffer, buf.byteOffset, n);
  };
  return { read, size, close: () => fs.closeSync(fd) };
}
