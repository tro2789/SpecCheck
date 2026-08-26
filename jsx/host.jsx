// Spec Check - ExtendScript host.
// Queueing idioms mirror Sequence Batch Exporter's production-verified host.

function SC_activeSeq() {
    if (!app.project || !app.project.activeSequence) return "";
    return String(app.project.activeSequence.name);
}

// Find a marker named "roomtone" (case/space-insensitive) on the active
// sequence; returns "startSeconds|durationSeconds|isPointMarker" or "".
function SC_roomtone() {
    if (!app.project || !app.project.activeSequence) return "";
    var ms = app.project.activeSequence.markers;
    if (!ms || ms.numMarkers === 0) return "";
    var m = ms.getFirstMarker();
    while (m) {
        var name = String(m.name).toLowerCase().replace(/[\s_-]+/g, "");
        if (name === "roomtone") {
            var s = m.start.seconds;
            var d = m.end.seconds - s;
            if (d <= 0.1) return s + "|2|1"; // point marker: panel searches near it
            return s + "|" + d + "|0";
        }
        m = ms.getNextMarker(m);
    }
    return "";
}

// workArea: 0 = entire sequence, 1 = in/out points, 2 = work area bar
function SC_renderActive(outPath, presetPath, workArea) {
    if (!app.project) return "err:no project open";
    var seq = app.project.activeSequence;
    if (!seq) return "err:no active sequence";
    var preset = new File(presetPath);
    if (!preset.exists) return "err:preset not found: " + presetPath;

    app.encoder.launchEncoder();
    var jobId = app.encoder.encodeSequence(seq, outPath, presetPath, parseInt(workArea, 10), 0);
    if (!jobId) return "err:AME rejected the job";
    app.encoder.startBatch();
    return "ok:" + jobId;
}
