import "./styles.css";
import type { Metrics } from "./analysis/types";
import { fmtVal, score, verdict } from "./evaluate";
import { BUILTIN_PRESETS, DEFAULT_PRESET, METRICS } from "./presets";
import type { WorkerMessage } from "./worker";

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const drop = $<HTMLDivElement>("drop");
const choose = $<HTMLButtonElement>("choose");
const input = $<HTMLInputElement>("file");
const spec = $<HTMLSelectElement>("spec");
const progress = $<HTMLDivElement>("progress");
const progressText = $<HTMLParagraphElement>("progressText");
const progressBar = $<HTMLProgressElement>("progressBar");
const announce = $<HTMLDivElement>("announce");
const error = $<HTMLParagraphElement>("error");
const results = $<HTMLElement>("results");
const verdictEl = $<HTMLParagraphElement>("verdict");
const verdictText = $<HTMLSpanElement>("verdictText");
const caption = $<HTMLTableCaptionElement>("caption");
const rows = $<HTMLTableSectionElement>("rows");

let worker: Worker | null = null;
let current: { name: string; metrics: Metrics } | null = null;

for (const name of Object.keys(BUILTIN_PRESETS)) {
  const o = document.createElement("option");
  o.value = name;
  o.textContent = name;
  spec.appendChild(o);
}
spec.value = DEFAULT_PRESET;
spec.addEventListener("change", render);

choose.addEventListener("click", () => input.click());
input.addEventListener("change", () => {
  const f = input.files?.[0];
  if (f) analyze(f);
  input.value = "";
});

drop.addEventListener("dragenter", (e) => { e.preventDefault(); drop.classList.add("over"); });
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  drop.classList.add("over");
});
drop.addEventListener("dragleave", (e) => {
  if (!drop.contains(e.relatedTarget as Node | null)) drop.classList.remove("over");
});
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f) analyze(f);
});
// A file dropped beside the zone must not navigate away from the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());

function analyze(file: File): void {
  worker?.terminate();
  current = null;
  results.hidden = true;
  error.textContent = "";
  progress.hidden = false;
  setProgress(file.name, 0);

  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  worker = w;
  let lastAnnounced = -1;
  w.onmessage = (e: MessageEvent<WorkerMessage>) => {
    if (w !== worker) return;
    const msg = e.data;
    if (msg.type === "progress") {
      const pct = setProgress(file.name, msg.fraction);
      // Announce in 25% steps so screen readers are not flooded.
      const step = Math.floor(pct / 25);
      if (step !== lastAnnounced && pct < 100) {
        lastAnnounced = step;
        announce.textContent = `Analyzing ${file.name}, ${pct}%`;
      }
      return;
    }
    w.terminate();
    worker = null;
    progress.hidden = true;
    if (msg.type === "error") {
      announce.textContent = "";
      error.textContent = msg.message;
      return;
    }
    current = { name: file.name, metrics: msg.metrics };
    render();
  };
  w.onerror = () => {
    if (w !== worker) return;
    w.terminate();
    worker = null;
    progress.hidden = true;
    error.textContent = "This file could not be read.";
  };
  w.postMessage({ file });
}

function setProgress(name: string, fraction: number): number {
  const pct = Math.min(100, Math.floor(fraction * 100));
  progressBar.value = pct;
  progressText.textContent = `Analyzing ${name}: ${pct}%`;
  return pct;
}

function cell(tag: "th" | "td", text: string, cls?: string): HTMLTableCellElement {
  const c = document.createElement(tag);
  if (cls) c.className = cls;
  c.textContent = text;
  return c;
}

/** A value the file did not yield (the panel prints "?"). */
function missing(c: HTMLTableCellElement): HTMLTableCellElement {
  c.textContent = "";
  const dash = document.createElement("span");
  dash.textContent = "–";
  dash.setAttribute("aria-hidden", "true");
  const sr = document.createElement("span");
  sr.className = "visually-hidden";
  sr.textContent = "No value";
  c.append(dash, sr);
  return c;
}

function render(): void {
  if (!current) return;
  const { metrics } = current;
  const name = spec.value;
  const checks = BUILTIN_PRESETS[name] ?? [];
  const s = score(metrics, checks);

  const sentence = verdict(s, checks.length, name);
  // Keep the spec name on one line ("ACX / Audible" must not split).
  const at = sentence.lastIndexOf(name);
  if (at >= 0) {
    const n = document.createElement("span");
    n.className = "nowrap";
    n.textContent = name;
    verdictText.replaceChildren(sentence.slice(0, at), n, sentence.slice(at + name.length));
  } else {
    verdictText.textContent = sentence;
  }
  verdictEl.className = "verdict " + (s.pass ? "pass" : "fail");

  caption.textContent = current.name + " ";
  const codec = document.createElement("span");
  codec.className = "codec";
  codec.textContent = metrics.codec;
  caption.appendChild(codec);

  rows.replaceChildren();
  for (const def of METRICS) {
    const chk = s.byMetric[def.key];
    const v = metrics[def.key];
    const tr = document.createElement("tr");
    if (!chk) tr.className = "unchecked";

    let label = def.label;
    if (def.key === "noiseFloor" && v !== null && v !== undefined) label += " (quietest\u00a00.5\u00a0s)";
    const th = cell("th", label);
    th.scope = "row";
    tr.appendChild(th);

    const state = chk?.pass === true ? " pass" : chk?.pass === false ? " fail" : "";
    const value = cell("td", "", "value num" + state);
    if (v === null || v === undefined) missing(value);
    else value.textContent = fmtVal(def, v);
    if (chk) {
      // Shown instead of the Target column on narrow screens.
      const t = document.createElement("span");
      t.className = "target-inline";
      const sr = document.createElement("span");
      sr.className = "visually-hidden";
      sr.textContent = "Target ";
      t.append(sr, chk.required);
      value.appendChild(t);
    }
    tr.appendChild(value);

    tr.appendChild(cell("td", chk ? chk.required : "", "target num"));

    const status = cell("td", "", "status" + state);
    if (chk) {
      if (chk.pass === null) missing(status);
      else status.textContent = chk.pass ? "Pass" : "Fail";
    }
    tr.appendChild(status);
    rows.appendChild(tr);
  }

  results.hidden = false;
  announce.textContent = sentence;
}
