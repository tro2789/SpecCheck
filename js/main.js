/* Spec Check - Phase 1 panel logic.
   Model: every analysis computes the FULL metric set; a preset is only a
   checklist of {metric, min?, max?} evaluated over cached measurements, so
   switching presets re-scores instantly with no re-analysis. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };

  function log(msg, cls) {
    var el = document.createElement("div");
    if (cls) el.className = cls;
    el.textContent = new Date().toTimeString().slice(0, 8) + "  " + msg;
    $("log").appendChild(el);
    $("log").scrollTop = $("log").scrollHeight;
  }

  /* ---------- Node bootstrap ---------- */

  var nodeRequire = null;
  if (typeof cep_node !== "undefined" && cep_node.require) {
    nodeRequire = cep_node.require;
    log("Node via cep_node.require", "ok");
  } else if (typeof require === "function") {
    nodeRequire = require;
    log("Node via global require (mixed context)", "ok");
  } else {
    log("NO Node access - manifest flags not honored.", "bad");
  }
  if (!nodeRequire) return;

  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var spawn = nodeRequire("child_process").spawn;

  /* ---------- metric + preset definitions ---------- */

  // Display order and formatting for the full metric set.
  var METRICS = [
    { key: "lufsI", label: "Integrated loudness", unit: " LUFS" },
    { key: "lra", label: "Loudness range", unit: " LU" },
    { key: "truePeak", label: "True peak", unit: " dBTP" },
    { key: "rmsDb", label: "Overall RMS", unit: " dB" },
    { key: "samplePeakDb", label: "Sample peak", unit: " dBFS" },
    { key: "minMomentary", label: "Noise floor (approx)", unit: " LUFS" },
    { key: "headSilence", label: "Head silence", unit: " s" },
    { key: "tailSilence", label: "Tail silence", unit: " s" },
    { key: "sampleRateHz", label: "Sample rate", unit: " Hz", int: true },
    { key: "bitrateKbps", label: "Bitrate", unit: " kbps", int: true },
    { key: "channels", label: "Channels", unit: "", int: true },
    { key: "duration", label: "Duration", unit: "", time: true }
  ];

  // Presets: checklists only. Unlisted metrics are shown but not judged.
  var PRESETS = {
    "ACX / Audible": [
      { m: "rmsDb", min: -23, max: -18 },
      { m: "samplePeakDb", max: -3 },
      { m: "minMomentary", max: -60 },
      { m: "bitrateKbps", min: 192 }
    ],
    "Apple Podcasts": [
      { m: "lufsI", min: -17, max: -15 },
      { m: "truePeak", max: -1 }
    ],
    "Spotify": [
      { m: "lufsI", min: -15, max: -13 },
      { m: "truePeak", max: -1 }
    ],
    "EBU R128 broadcast": [
      { m: "lufsI", min: -23.5, max: -22.5 },
      { m: "truePeak", max: -1 }
    ],
    "YouTube": [
      { m: "lufsI", min: -15, max: -13 },
      { m: "truePeak", max: -1 }
    ]
  };

  /* ---------- state ---------- */

  var cache = {};      // key(path|size|mtime) -> metrics
  var results = [];    // [{path, key}] session list, newest last
  var selectedPath = null;
  var showAll = false; // scoreboard: checked metrics only vs full set

  function cacheKey(file, st) { return file + "|" + st.size + "|" + st.mtimeMs; }

  /* ---------- ffmpeg / ffprobe location ---------- */

  var extDir = decodeURIComponent(
    window.__adobe_cep__.getSystemPath("extension").replace(/^file:\/{2,3}/, "")
  );
  var FF = null, FP = null;

  /* ---------- host skin adaptation ---------- */

  function applySkin() {
    // Derive every surface color from Premiere's panel background so the
    // panel follows the host brightness slider. Rules live in DESIGN.md.
    var c;
    try {
      var env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
      c = env.appSkinInfo.panelBackgroundColor.color; // {red,green,blue} 0-255
    } catch (e) { return; } // keep CSS defaults
    if (!c) return;
    var mix = function (v, target, f) { return Math.round(v + (target - v) * f); };
    var rgb = function (r, g, b) { return "rgb(" + r + "," + g + "," + b + ")"; };
    var toward = function (target, f) {
      return rgb(mix(c.red, target, f), mix(c.green, target, f), mix(c.blue, target, f));
    };
    var lum = (0.299 * c.red + 0.587 * c.green + 0.114 * c.blue) / 255;
    var darkSkin = lum < 0.5;
    var s = document.documentElement.style;
    s.setProperty("--bg", rgb(Math.round(c.red), Math.round(c.green), Math.round(c.blue)));
    s.setProperty("--surface", toward(darkSkin ? 255 : 0, 0.04));
    s.setProperty("--inset", toward(darkSkin ? 0 : 255, 0.22));
    s.setProperty("--line", toward(darkSkin ? 255 : 0, 0.11));
    s.setProperty("--text", darkSkin ? "#d6d6d6" : "#242424");
    s.setProperty("--dim", darkSkin ? "#8f8f8f" : "#6c6c6c");
  }
  applySkin();
  try {
    window.__adobe_cep__.addEventListener(
      "com.adobe.csxs.events.ThemeColorChanged", applySkin, null);
  } catch (e) {}

  function findTools() {
    var local = path.join(extDir, "tools", "ffmpeg", "bin");
    var candidates = [
      { ff: path.join(local, "ffmpeg.exe"), fp: path.join(local, "ffprobe.exe"), label: "bundled" },
      { ff: "ffmpeg", fp: "ffprobe", label: "PATH" }
    ];
    var i = 0;
    function tryNext(reason) {
      if (reason) log("ffmpeg candidate failed: " + reason, "dim");
      if (i >= candidates.length) {
        log("ffmpeg not found - run setup-ffmpeg.ps1, then reopen the panel", "bad");
        return;
      }
      var c = candidates[i++];
      var p;
      try { p = spawn(c.ff, ["-version"]); }
      catch (e) { tryNext(c.label + " spawn threw " + e.message); return; }
      var settled = false;
      var once = function (fn) {
        return function (a) { if (!settled) { settled = true; fn(a); } };
      };
      var out = "";
      p.stdout.on("data", function (d) { out += d; });
      p.on("error", once(function (e) { tryNext(c.label + " error " + (e.code || e.message)); }));
      p.on("close", once(function (code) {
        if (code === 0) {
          FF = c.ff; FP = c.fp;
          var ver = ((out.match(/ffmpeg version (\S+)/) || [])[1] || "?").split("-")[0];
          log("ffmpeg " + ver + " ready (" + c.label + ")", "ok");
          $("btnPick").disabled = false;
          $("btnWatch").disabled = false;
        } else { tryNext(c.label + " exit code " + code); }
      }));
    }
    tryNext();
  }

  function run(cmd, args) {
    return new Promise(function (resolve, reject) {
      var p = spawn(cmd, args);
      var out = "", err = "";
      p.stdout.on("data", function (d) { out += d; });
      p.stderr.on("data", function (d) { err += d; });
      p.on("error", reject);
      p.on("close", function () { resolve({ stdout: out, stderr: err }); });
    });
  }

  /* ---------- analysis ---------- */

  function parseEbur128(stderr) {
    var tail = stderr.slice(stderr.lastIndexOf("Summary:"));
    var num = function (re) {
      var m = tail.match(re);
      return m ? parseFloat(m[1]) : null;
    };
    // Quietest momentary (400 ms) window above digital silence, from the
    // per-frame lines: an approximation of noise floor for gaps/room tone.
    var mm = null, re = /M:\s*(-?[\d.]+)/g, m;
    while ((m = re.exec(stderr)) !== null) {
      var v = parseFloat(m[1]);
      if (v > -100 && (mm === null || v < mm)) mm = v;
    }
    return {
      lufsI: num(/I:\s+(-?[\d.]+) LUFS/),
      lra: num(/LRA:\s+([\d.]+) LU/),
      truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/),
      minMomentary: mm
    };
  }

  function parseAstats(stderr) {
    var rms = null, peak = null, re = /(RMS|Peak) level dB:\s*(-?[\d.]+)/g, m;
    while ((m = re.exec(stderr)) !== null) {
      if (m[1] === "RMS") rms = parseFloat(m[2]);
      else peak = parseFloat(m[2]);
    }
    return { rmsDb: rms, samplePeakDb: peak };
  }

  function parseSilence(stderr, duration) {
    var starts = [], ends = [], re = /silence_(start|end): (-?[\d.]+)/g, m;
    while ((m = re.exec(stderr)) !== null) {
      (m[1] === "start" ? starts : ends).push(parseFloat(m[2]));
    }
    var head = (starts.length && starts[0] < 0.05) ? ((ends[0] || duration) - starts[0]) : 0;
    var tail = 0;
    if (starts.length) {
      var lastStart = starts[starts.length - 1];
      var lastEnd = ends.length >= starts.length ? ends[ends.length - 1] : null;
      if (lastEnd === null || (duration && duration - lastEnd < 0.05)) {
        tail = (duration || 0) - lastStart;
      }
    }
    return { headSilence: head, tailSilence: Math.max(0, tail) };
  }

  function analyze(file) {
    var st;
    try { st = fs.statSync(file); }
    catch (e) { log("Cannot stat " + file + ": " + e.message, "bad"); return; }
    var key = cacheKey(file, st);
    upsertResult(file, key);
    if (cache[key]) {           // measure once - same file+size+mtime
      selectedPath = file;
      renderAll();
      return;
    }
    log("Analyzing " + path.basename(file) + " ...");
    var t0 = Date.now(), metrics = { file: path.basename(file), path: file };

    run(FP, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file])
      .then(function (r) {
        var info = JSON.parse(r.stdout);
        var a = (info.streams || []).filter(function (s) { return s.codec_type === "audio"; })[0] || {};
        var f = info.format || {};
        metrics.duration = parseFloat(f.duration) || null;
        metrics.sampleRateHz = a.sample_rate ? parseInt(a.sample_rate, 10) : null;
        metrics.channels = a.channels || null;
        metrics.codec = a.codec_name || "?";
        var br = parseInt(a.bit_rate || f.bit_rate, 10);
        metrics.bitrateKbps = isNaN(br) ? null : Math.round(br / 1000);
        return run(FF, ["-nostats", "-i", file, "-map", "0:a:0",
          "-af", "ebur128=peak=true", "-f", "null", "-"]);
      })
      .then(function (r) {
        var e = parseEbur128(r.stderr);
        metrics.lufsI = e.lufsI; metrics.lra = e.lra;
        metrics.truePeak = e.truePeak; metrics.minMomentary = e.minMomentary;
        return run(FF, ["-nostats", "-i", file, "-map", "0:a:0",
          "-af", "astats=measure_perchannel=none", "-f", "null", "-"]);
      })
      .then(function (r) {
        var s = parseAstats(r.stderr);
        metrics.rmsDb = s.rmsDb; metrics.samplePeakDb = s.samplePeakDb;
        return run(FF, ["-nostats", "-i", file, "-map", "0:a:0",
          "-af", "silencedetect=n=-60dB:d=1", "-f", "null", "-"]);
      })
      .then(function (r) {
        var s = parseSilence(r.stderr, metrics.duration);
        metrics.headSilence = s.headSilence; metrics.tailSilence = s.tailSilence;
        cache[key] = metrics;
        selectedPath = file;
        renderAll();
        log("Done in " + ((Date.now() - t0) / 1000).toFixed(1) + " s", "ok");
      })
      .catch(function (e) { log("Analysis failed: " + e.message, "bad"); });
  }

  function upsertResult(file, key) {
    for (var i = 0; i < results.length; i++) {
      if (results[i].path === file) { results[i].key = key; return; }
    }
    results.push({ path: file, key: key });
  }

  /* ---------- scoring ---------- */

  function activeChecks() { return PRESETS[$("preset").value] || []; }

  function score(metrics) {
    // returns {byMetric: {key: {required, pass|null}}, pass, failCount, unknown}
    var by = {}, pass = true, fails = 0, unknown = 0;
    activeChecks().forEach(function (c) {
      var v = metrics ? metrics[c.m] : null;
      var req = (c.min !== undefined && c.max !== undefined) ? c.min + " to " + c.max
        : (c.min !== undefined) ? ">= " + c.min : "<= " + c.max;
      var ok = null;
      if (v !== null && v !== undefined) {
        ok = (c.min === undefined || v >= c.min) && (c.max === undefined || v <= c.max);
        if (!ok) { pass = false; fails++; }
      } else { unknown++; }
      by[c.m] = { required: req, pass: ok };
    });
    return { byMetric: by, pass: pass, failCount: fails, unknown: unknown };
  }

  /* ---------- rendering ---------- */

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function fmtVal(def, v) {
    if (v === null || v === undefined) return "?";
    if (def.time) {
      var t = Math.round(v), h = Math.floor(t / 3600),
        mm = Math.floor(t / 60) % 60, ss = t % 60;
      var pad = function (n) { return (n < 10 ? "0" : "") + n; };
      return (h ? h + ":" + pad(mm) : String(mm)) + ":" + pad(ss);
    }
    return (def.int ? String(Math.round(v)) : v.toFixed(1)) + def.unit;
  }

  function renderAll() {
    renderResults();
    renderScoreboard();
  }

  function renderResults() {
    var sel = $("resultSel"), dot = $("rdot");
    while (sel.firstChild) sel.removeChild(sel.firstChild);
    if (!results.length) {
      var o = el("option", null, "No results yet - analyze a file or watch a folder");
      o.disabled = true; o.selected = true;
      sel.appendChild(o);
      sel.disabled = true;
      dot.className = "dot";
      return;
    }
    sel.disabled = false;
    results.slice().reverse().forEach(function (r) {   // newest first
      var m = cache[r.key];
      var label = path.basename(r.path);
      if (!m) label += "  (analyzing…)";
      else {
        var s = score(m);
        label += s.pass ? "  (pass)" : "  (" + s.failCount + " fail)";
      }
      var o = el("option", null, label);
      o.value = r.path;
      sel.appendChild(o);
    });
    if (selectedPath) sel.value = selectedPath;
    var sm = null;
    results.forEach(function (r) { if (r.path === selectedPath) sm = cache[r.key]; });
    dot.className = "dot" + (sm ? (score(sm).pass ? " pass" : " fail") : "");
  }

  // Meter window: where the track starts/ends and where the allowed band sits.
  function meterWindow(c) {
    if (c.min !== undefined && c.max !== undefined) {
      var pad = (c.max - c.min) || 1;
      return { wLo: c.min - pad, wHi: c.max + pad, bLo: c.min, bHi: c.max };
    }
    if (c.max !== undefined) {
      var span = Math.max(Math.abs(c.max) * 0.5, 6);
      return { wLo: c.max - span, wHi: c.max + span * 0.5, bLo: c.max - span, bHi: c.max };
    }
    var span2 = Math.max(Math.abs(c.min) * 0.5, 6);
    return { wLo: c.min - span2 * 0.5, wHi: c.min + span2, bLo: c.min, bHi: c.min + span2 };
  }

  function pct(v, w) {
    var p = (v - w.wLo) / (w.wHi - w.wLo) * 100;
    return Math.max(2, Math.min(98, p));
  }

  function renderScoreboard() {
    var t = $("metrics");
    while (t.firstChild) t.removeChild(t.firstChild);
    var entry = null;
    results.forEach(function (r) { if (r.path === selectedPath) entry = r; });
    var m = entry ? cache[entry.key] : null;
    if (!m) return;

    var s = score(m);
    var hidden = 0;
    METRICS.forEach(function (def) {
      var chk = s.byMetric[def.key];
      if (!chk && !showAll) { hidden++; return; }
      var row = el("div", "mrow" + (chk ? "" : " unchecked"));
      row.appendChild(el("span", "mlabel", def.label));
      row.appendChild(el("span",
        "mval" + (chk && chk.pass === false ? " fail" : ""),
        fmtVal(def, m[def.key])));
      row.appendChild(el("span", "mreq", chk ? chk.required : ""));
      if (chk) {
        var check = null;
        activeChecks().forEach(function (c) { if (c.m === def.key) check = c; });
        var v = m[def.key];
        var meter = el("div", "meter");
        if (check && v !== null && v !== undefined) {
          var w = meterWindow(check);
          var band = el("div", "band");
          band.style.left = pct(w.bLo, w) + "%";
          band.style.width = (pct(w.bHi, w) - pct(w.bLo, w)) + "%";
          meter.appendChild(band);
          var mark = el("div", "mark " + (chk.pass ? "pass" : "fail"));
          mark.style.left = pct(v, w) + "%";
          meter.appendChild(mark);
        }
        row.appendChild(meter);
      } else {
        row.appendChild(el("div", "meter-spacer"));
      }
      t.appendChild(row);
    });

    var toggle = el("div", "mtoggle",
      showAll ? "Show checked only" : "Show all metrics (" + hidden + " more)");
    toggle.addEventListener("click", function () {
      showAll = !showAll;
      saveState();
      renderScoreboard();
    });
    t.appendChild(toggle);
  }

  /* ---------- watch folder ---------- */

  var EXTS = { ".wav": 1, ".mp3": 1, ".mp4": 1, ".m4a": 1, ".flac": 1, ".aif": 1, ".aiff": 1 };
  var watcher = null, pollTimer = null;
  var candidates = {}; // path -> {size, stableSince, done}

  function lockFree(file) {
    try {
      var fd = fs.openSync(file, "r+");
      fs.closeSync(fd);
      return true;
    } catch (e) { return false; }
  }

  function poll() {
    Object.keys(candidates).forEach(function (f) {
      var c = candidates[f];
      if (c.done) return;
      var st;
      try { st = fs.statSync(f); } catch (e) { return; }
      var now = Date.now();
      if (st.size !== c.size) {
        c.size = st.size; c.stableSince = now;
        return;
      }
      if (now - c.stableSince >= 2000 && lockFree(f)) {
        c.done = true;
        log(path.basename(f) + ": complete, analyzing", "ok");
        analyze(f);
      }
    });
  }

  function startWatch(dir) {
    stopWatch();
    try {
      watcher = fs.watch(dir, { recursive: true }, function (evt, name) {
        if (!name) return;
        var f = path.join(dir, name);
        var ext = path.extname(name).toLowerCase();
        if (!EXTS[ext]) return;
        if (!candidates[f]) {
          candidates[f] = { size: -1, stableSince: Date.now(), done: false };
          log("New file: " + name);
        }
      });
    } catch (e) {
      log("fs.watch failed: " + e.message, "bad");
      return;
    }
    pollTimer = setInterval(poll, 500);
    $("btnWatch").textContent = "Stop";
    $("watchPath").disabled = true;
    log("Watch started: " + dir, "ok");
  }

  function stopWatch() {
    if (watcher) { watcher.close(); watcher = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    candidates = {};
    $("btnWatch").textContent = "Start";
    $("watchPath").disabled = false;
  }

  /* ---------- UI wiring ---------- */

  var STORE = "speccheck_state_v1";

  function saveState() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        preset: $("preset").value,
        watchPath: $("watchPath").value,
        showAll: showAll
      }));
    } catch (e) {}
  }

  function initUI() {
    var sel = $("preset");
    Object.keys(PRESETS).forEach(function (name) {
      var o = document.createElement("option");
      o.value = name; o.textContent = name;
      sel.appendChild(o);
    });
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) {}
    if (saved.preset && PRESETS[saved.preset]) sel.value = saved.preset;
    if (saved.watchPath) $("watchPath").value = saved.watchPath;
    if (saved.showAll) showAll = true;

    sel.addEventListener("change", function () { saveState(); renderAll(); });

    $("resultSel").addEventListener("change", function () {
      selectedPath = this.value;
      renderAll();
    });

    $("btnPick").addEventListener("click", function () {
      var r = window.cep.fs.showOpenDialogEx(true, false, "Choose audio or video files", "",
        ["wav", "mp3", "mp4", "m4a", "flac", "aif", "aiff"]);
      if (r.data) r.data.forEach(analyze);
    });

    $("btnBrowse").addEventListener("click", function () {
      var r = window.cep.fs.showOpenDialogEx(false, true, "Choose folder to watch", "");
      if (r.data && r.data.length) { $("watchPath").value = r.data[0]; saveState(); }
    });

    $("btnWatch").addEventListener("click", function () {
      if (watcher) { stopWatch(); return; }
      var dir = $("watchPath").value.trim();
      if (!dir) { log("Pick a folder first", "bad"); return; }
      saveState();
      startWatch(dir);
    });
  }

  initUI();
  renderAll();
  findTools();

  // Dev-only hook: lets a browser harness inject canned metrics to preview
  // the UI outside Premiere. No effect in normal use.
  window.__specDebug = {
    inject: function (metrics) {
      var key = "demo|" + metrics.file;
      cache[key] = metrics;
      upsertResult(metrics.path || metrics.file, key);
      // upsertResult keys by path; force our demo key
      results.forEach(function (r) {
        if (r.path === (metrics.path || metrics.file)) r.key = key;
      });
      selectedPath = metrics.path || metrics.file;
      renderAll();
    }
  };
})();
