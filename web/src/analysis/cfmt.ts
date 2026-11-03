/* The panel never sees ffmpeg's doubles: it parses ffmpeg's printed text.
   These helpers reproduce that round trip so the web app compares and
   displays exactly what the panel would. */

/** C printf("%.<digits>f") for a double, as glibc prints it. */
export function cFixed(x: number, digits: number): string {
  if (Number.isNaN(x)) return "nan";
  if (x === Infinity) return "inf";
  if (x === -Infinity) return "-inf";
  const neg = x < 0 || Object.is(x, -0);
  const a = Math.abs(x);
  let s = a.toFixed(digits);
  // glibc rounds exact binary ties half to even; toFixed rounds them up.
  // A double is an exact tie at this precision iff a * 2^(digits+1) is odd.
  const t = a * 2 ** (digits + 1);
  if (Number.isInteger(t) && t % 2 === 1) {
    const scale = 10 ** digits;
    let n = Math.floor(a * scale);
    if (n % 2 === 1) n += 1;
    s = (n / scale).toFixed(digits);
  }
  return (neg ? "-" : "") + s;
}

/** The panel's number capture `(-?[\d.]+)` (or `([\d.]+)`) applied to one
    printed token: a non-numeric token such as "-inf" or "nan" is no match. */
export function panelNum(token: string, allowNegative = true): number | null {
  const re = allowNegative ? /^-?[\d.]+$/ : /^[\d.]+$/;
  return re.test(token) ? parseFloat(token) : null;
}

/** What the panel reads for a value ffmpeg printed with "%.<digits>f". */
export function printed(x: number, digits: number, allowNegative = true): number | null {
  return panelNum(cFixed(x, digits), allowNegative);
}

/** av_ts2timestr(): seconds printed with 6 decimals (more below 1 s). */
export function tsSeconds(val: number): number {
  const lg = val === 0 ? -Infinity : Math.floor(Math.log10(Math.abs(val)));
  const precision = Number.isFinite(lg) && lg < 0 ? -lg + 5 : 6;
  return parseFloat(cFixed(val, precision));
}
