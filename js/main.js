/* Spec Check - Phase 0 spike panel logic.
   Proves, inside CEP's Node runtime:
     1. spawning ffmpeg/ffprobe and parsing loudness metrics
     2. watch-folder completion detection (size stability + lock release)
   Log lines are the spike's deliverable - they answer which signals work. */
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

  /* ---------- Node bootstrap (spike question #0: which accessor exists) ---------- */

  var nodeRequire = null;
  if (typeof cep_node !== "undefined" && cep_node.require) {
    nodeRequire = cep_node.require;
    log("Node via cep_node.require", "ok");
  } else if (typeof require === "function") {
    nodeRequire = require;
    log("Node via global require (mixed context)", "ok");
  } else {
    log("NO Node access - manifest flags not honored. Spike blocked.", "bad");
  }
  if (!nodeRequire) return;

  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var spawn = nodeRequire("child_process").spawn;
  var proc = (typeof cep_node !== "undefined" && cep_node.process) || nodeRequire("process");
  log("Node " + proc.version + " on " + proc.platform, "dim");

  /* ---------- ffmpeg / ffprobe location ---------- */

  var extDir = window.__adobe_cep__.getSystemPath("extension");
  var FF = null, FP = null;

  function findTools() {
    var local = path.join(extDir, "tools", "ffmpeg", "bin");
    var candidates = [
      { ff: path.join(local, "ffmpeg.exe"), fp: path.join(local, "ffprobe.exe") },
      { ff: "ffmpeg", fp: "ffprobe" } // PATH fallback
    ];
    var i = 0;
    function tryNext() {
      if (i >= candidates.length) {
        $("ffstatus").textContent = "ffmpeg: NOT FOUND - run setup-ffmpeg.ps1";
        $("ffstatus").className = "bad";
        return;
      }
      var c = candidates[i++];
      var p = spawn(c.ff, ["-version"]);
      var out = "";
      p.stdout.on("data", function (d) { out += d; });
      p.on("error", tryNext);
      p.on("close", function (code) {
        if (code === 0) {
          FF = c.ff; FP = c.fp;
          var ver = (out.match(/ffmpeg version (\S+)/) || [])[1] || "?";
          $("ffstatus").textContent = "ffmpeg " + ver + (c.ff === "ffmpeg" ? " (PATH)" : " (bundled)");
          $("ffstatus").className = "ok";
          log("ffmpeg found: " + c.ff, "ok");
        } else { tryNext(); }
      });
    }
    tryNext();
  }

  /* ---------- run a tool, capture output ---------- */

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

  /* ---------- analysis passes ---------- */

  function parseEbur128(stderr) {
    // Summary block: labels are stable, whitespace is not.
    var tail = stderr.slice(stderr.lastIndexOf("Summary:"));
    var num = function (re) {
      var m = tail.match(re);
      return m ? parseFloat(m[1]) : null;
    };
    return {
      lufsI: num(/I:\s+(-?[\d.]+) LUFS/),
      lra: num(/LRA:\s+([\d.]+) LU/),
      truePeak: num(/Peak:\s+(-?[\d.]+) dBFS/) // first Peak after Summary is true peak section
    };
  }

  function parseAstats(stderr) {
    // Use the LAST "RMS level dB" / "Peak level dB" = Overall section.
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
    log("Analyzing " + path.basename(file) + " ...");
    $("curfile").textContent = path.basename(file);
    var t0 = Date.now(), metrics = { file: path.basename(file) };

    run(FP, ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file])
      .then(function (r) {
        var info = JSON.parse(r.stdout);
        var a = (info.streams || []).filter(function (s) { return s.codec_type === "audio"; })[0] || {};
        metrics.duration = parseFloat((info.format || {}).duration) || null;
        metrics.sampleRate = a.sample_rate ? a.sample_rate + " Hz" : "?";
        metrics.channels = a.channels;
        metrics.bitDepth = a.bits_per_raw_sample || a.bits_per_sample || (a.sample_fmt || "?");
        metrics.codec = a.codec_name;
        return run(FF, ["-nostats", "-i", file, "-map", "0:a:0",
          "-af", "ebur128=peak=true", "-f", "null", "-"]);
      })
      .then(function (r) {
        var e = parseEbur128(r.stderr);
        metrics.lufsI = e.lufsI; metrics.lra = e.lra; metrics.truePeak = e.truePeak;
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
        render(metrics);
        log("Done in " + ((Date.now() - t0) / 1000).toFixed(1) + " s", "ok");
      })
      .catch(function (e) { log("Analysis failed: " + e.message, "bad"); });
  }

  function render(m) {
    var rows = [
      ["File", m.file],
      ["Duration", m.duration ? m.duration.toFixed(1) + " s" : "?"],
      ["Format", m.codec + " / " + m.sampleRate + " / " + m.channels + "ch / " + m.bitDepth],
      ["Integrated loudness", fmt(m.lufsI, " LUFS")],
      ["Loudness range", fmt(m.lra, " LU")],
      ["True peak", fmt(m.truePeak, " dBTP")],
      ["Overall RMS", fmt(m.rmsDb, " dB")],
      ["Sample peak", fmt(m.samplePeakDb, " dBFS")],
      ["Head silence", fmt(m.headSilence, " s")],
      ["Tail silence", fmt(m.tailSilence, " s")]
    ];
    var t = $("metrics");
    while (t.firstChild) t.removeChild(t.firstChild);
    var head = document.createElement("tr");
    ["Metric", "Value"].forEach(function (h) {
      var th = document.createElement("th");
      th.textContent = h;
      head.appendChild(th);
    });
    t.appendChild(head);
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      var name = document.createElement("td");
      name.textContent = r[0];
      var val = document.createElement("td");
      val.className = "num";
      val.textContent = r[1];
      tr.appendChild(name);
      tr.appendChild(val);
      t.appendChild(tr);
    });
  }

  function fmt(v, unit) { return (v === null || v === undefined) ? "?" : v.toFixed(1) + unit; }

  /* ---------- watch folder: completion detection ---------- */

  var EXTS = { ".wav": 1, ".mp3": 1, ".mp4": 1, ".m4a": 1, ".flac": 1, ".aif": 1, ".aiff": 1 };
  var watcher = null, pollTimer = null;
  var candidates = {}; // path -> {size, stableSince, done}

  function lockProbe(file) {
    // Spike question: does an exclusive-ish open fail while AME still writes?
    try {
      var fd = fs.openSync(file, "r+");
      fs.closeSync(fd);
      return { open: true };
    } catch (e) {
      return { open: false, code: e.code };
    }
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
      var stableMs = now - c.stableSince;
      var lock = lockProbe(f);
      if (stableMs >= 2000) {
        if (!c.loggedStable) {
          c.loggedStable = true;
          log(path.basename(f) + ": size stable 2s (" + st.size + " bytes), exclusive open=" +
            (lock.open ? "OK" : "BLOCKED " + lock.code), lock.open ? "ok" : "dim");
        }
        if (lock.open) {
          c.done = true;
          log(path.basename(f) + ": COMPLETE (stable + lock released)", "ok");
          analyze(f);
        }
      }
    });
  }

  function startWatch(dir) {
    stopWatch();
    try {
      watcher = fs.watch(dir, function (evt, name) {
        if (!name) return;
        var f = path.join(dir, name);
        var ext = path.extname(name).toLowerCase();
        if (!EXTS[ext]) return;
        if (!candidates[f]) {
          candidates[f] = { size: -1, stableSince: Date.now(), done: false };
          log("Watching new file: " + name + " (event: " + evt + ")");
        }
      });
    } catch (e) {
      log("fs.watch failed: " + e.message + " - polling fallback needed for this path", "bad");
      return;
    }
    pollTimer = setInterval(poll, 500);
    $("watchState").textContent = "watching " + dir;
    $("btnWatch").textContent = "Stop watching";
    log("Watch started: " + dir, "ok");
  }

  function stopWatch() {
    if (watcher) { watcher.close(); watcher = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    candidates = {};
    $("watchState").textContent = "idle";
    $("btnWatch").textContent = "Start watching";
  }

  /* ---------- UI wiring ---------- */

  $("btnPick").addEventListener("click", function () {
    var r = window.cep.fs.showOpenDialogEx(false, false, "Choose an audio or video file", "",
      ["wav", "mp3", "mp4", "m4a", "flac", "aif", "aiff"]);
    if (r.data && r.data.length) analyze(r.data[0]);
  });

  $("btnBrowse").addEventListener("click", function () {
    var r = window.cep.fs.showOpenDialogEx(false, true, "Choose folder to watch", "");
    if (r.data && r.data.length) $("watchPath").value = r.data[0];
  });

  $("btnWatch").addEventListener("click", function () {
    if (watcher) { stopWatch(); return; }
    var dir = $("watchPath").value.trim();
    if (!dir) { log("Pick a folder first", "bad"); return; }
    startWatch(dir);
  });

  findTools();
})();
