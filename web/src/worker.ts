/* Decoding and analysis run here, off the main thread. The file is read
   in slices; nothing leaves the browser. */

import { analyzeFile } from "./analyze-file";
import type { Metrics } from "./analysis/types";
import { UnsupportedFileError } from "./decode/source";

export interface WorkerRequest {
  file: File;
}

export type WorkerMessage =
  | { type: "progress"; fraction: number }
  | { type: "result"; metrics: Metrics }
  | { type: "error"; message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<WorkerRequest>) => void) | null;
  postMessage(message: WorkerMessage): void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = async (e) => {
  const { file } = e.data;
  let last = 0;
  try {
    const metrics = await analyzeFile(
      async (start, end) => new Uint8Array(await file.slice(start, end).arrayBuffer()),
      file.size,
      {
        onProgress: (fraction) => {
          const now = performance.now();
          if (now - last < 100 && fraction < 1) return;
          last = now;
          scope.postMessage({ type: "progress", fraction });
        },
      },
    );
    scope.postMessage({ type: "result", metrics });
  } catch (err) {
    if (!(err instanceof UnsupportedFileError)) console.error(err);
    scope.postMessage({
      type: "error",
      message: err instanceof UnsupportedFileError ? err.message : "This file could not be read.",
    });
  }
};
