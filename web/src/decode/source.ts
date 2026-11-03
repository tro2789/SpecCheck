/** Reads bytes [start, end) of the file being analyzed. */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

/** A file Spec Check cannot read; the message is shown to the user. */
export class UnsupportedFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedFileError";
  }
}
