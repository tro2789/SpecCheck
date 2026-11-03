// Pulls definitions out of the Premiere panel's js/main.js so the fixture
// script and the tests run the panel's own code, not a copy of it.
import fs from "node:fs";

export function readPanelSource() {
  return fs.readFileSync(new URL("../../js/main.js", import.meta.url), "utf8");
}

/** Text from the first match of `start` through the bracket that closes the
    first `open` bracket after it. Skips strings and comments. */
export function extractBalanced(src, start, open = "{") {
  const m = start.exec(src);
  if (!m) throw new Error(`panel source: ${start} not found`);
  const close = open === "{" ? "}" : open === "[" ? "]" : ")";
  let i = src.indexOf(open, m.index);
  let depth = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
    } else if (c === "/" && src[i + 1] === "/") {
      i = src.indexOf("\n", i);
    } else if (c === "/" && src[i + 1] === "*") {
      i = src.indexOf("*/", i) + 1;
    } else if (c === open) {
      depth++;
    } else if (c === close && --depth === 0) {
      return src.slice(m.index, i + 1);
    }
  }
  throw new Error(`panel source: unbalanced ${open} after ${start}`);
}

const literal = (src, name, open) => {
  const text = extractBalanced(src, new RegExp(`var ${name}\\s*=`), open);
  return new Function(`return (${text.slice(text.indexOf(open))});`)();
};

const fn = (src, name) => extractBalanced(src, new RegExp(`function ${name}\\s*\\(`));

export function panelPresets(src = readPanelSource()) {
  return literal(src, "BUILTIN_PRESETS", "{");
}

export function panelMetricDefs(src = readPanelSource()) {
  return literal(src, "METRICS", "[");
}

/** parseEbur128, parseAstats, parseSilence exactly as the panel has them. */
export function panelParsers(src = readPanelSource()) {
  const body = ["parseEbur128", "parseAstats", "parseSilence"].map((n) => fn(src, n)).join("\n");
  return new Function(`${body}\nreturn { parseEbur128, parseAstats, parseSilence };`)();
}

/** The panel's score() and fmtVal(), with activeChecks() returning `checks`. */
export function panelScoring(checks, src = readPanelSource()) {
  const body = [fn(src, "fmtVal"), fn(src, "score")].join("\n");
  return new Function("METRICS", "activeChecks", `${body}\nreturn { score, fmtVal };`)(
    panelMetricDefs(src), () => checks);
}
