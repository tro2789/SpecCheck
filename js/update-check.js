/* Update check, shared by the Trevor O'Hare Productions CEP panels.
   At most once a day, asks GitHub for the latest release of this panel's repo
   and compares it with ExtensionBundleVersion in CSXS/manifest.xml. If a newer
   version exists, shows a one-line notice linking to the download page.
   Configure on the script tag:
     <script src="js/update-check.js" data-repo="owner/repo" data-url="https://..."></script>
   The same file is copied into each panel; keep the copies identical. */
(function () {
  "use strict";

  var script = document.currentScript;
  var REPO = script && script.getAttribute("data-repo");
  var PAGE = script && script.getAttribute("data-url");
  if (!REPO || !PAGE) return;

  var KEY = "tohare_update_" + REPO;
  var DAY = 24 * 60 * 60 * 1000;

  function cmp(a, b) {
    a = String(a).replace(/^v/i, "").split(".");
    b = String(b).replace(/^v/i, "").split(".");
    for (var i = 0; i < Math.max(a.length, b.length); i++) {
      var d = (parseInt(a[i], 10) || 0) - (parseInt(b[i], 10) || 0);
      if (d) return d > 0 ? 1 : -1;
    }
    return 0;
  }

  function currentVersion() {
    try {
      var ext = window.__adobe_cep__.getSystemPath("extension");
      ext = decodeURIComponent(String(ext).replace(/^file:\/{2,3}/, ""));
      var r = window.cep.fs.readFile(ext + "/CSXS/manifest.xml");
      if (r.err !== 0) return null;
      var m = r.data.match(/ExtensionBundleVersion="([^"]+)"/);
      return m ? m[1] : null;
    } catch (e) { return null; }
  }

  // The throttle cache is disposable, so localStorage is fine here.
  function readCache() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; }
  }
  function writeCache(c) {
    try { localStorage.setItem(KEY, JSON.stringify(c)); } catch (e) { /* ignore */ }
  }

  function fetchLatest(done) {
    var xhr = new XMLHttpRequest();
    xhr.open("GET", "https://api.github.com/repos/" + REPO + "/releases/latest");
    xhr.setRequestHeader("Accept", "application/vnd.github+json");
    xhr.timeout = 10000;
    xhr.onload = function () {
      if (xhr.status !== 200) return done(null);
      try { done(JSON.parse(xhr.responseText).tag_name || null); } catch (e) { done(null); }
    };
    xhr.onerror = xhr.ontimeout = function () { done(null); };
    xhr.send();
  }

  function openUrl() {
    try { window.cep.util.openURLInDefaultBrowser(PAGE); }
    catch (e) { window.open(PAGE); }
  }

  function show(latest, cache) {
    var bar = document.createElement("div");
    bar.setAttribute("style",
      "display:flex;align-items:center;gap:8px;margin:0 0 8px;padding:5px 8px;" +
      "border-radius:3px;background:#1f3a5f;color:#e6eefa;font-size:11px;line-height:1.3;");
    var text = document.createElement("span");
    text.setAttribute("style", "flex:1;cursor:pointer;");
    text.title = PAGE;
    text.textContent = "Version " + latest.replace(/^v/i, "") + " is available. Click to download.";
    text.onclick = openUrl;
    var close = document.createElement("span");
    close.setAttribute("style", "cursor:pointer;padding:0 2px;opacity:0.8;");
    close.title = "Hide until the next version";
    close.textContent = "✕";
    close.onclick = function () {
      cache.dismissed = latest;
      writeCache(cache);
      bar.parentNode.removeChild(bar);
    };
    bar.appendChild(text);
    bar.appendChild(close);
    document.body.insertBefore(bar, document.body.firstChild);
  }

  function decide(current, cache) {
    var latest = cache.latest;
    if (latest && cmp(latest, current) > 0 && cache.dismissed !== latest) show(latest, cache);
  }

  function run() {
    var current = currentVersion();
    if (!current) return;
    var cache = readCache();
    if (cache.checked && Date.now() - cache.checked < DAY) return decide(current, cache);
    fetchLatest(function (tag) {
      cache.checked = Date.now();
      if (tag) cache.latest = tag;
      writeCache(cache);
      decide(current, cache);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run);
  else run();
})();
