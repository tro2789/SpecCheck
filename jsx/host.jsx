// Spec Check - ExtendScript host.
// Queueing idioms mirror Sequence Batch Exporter's production-verified host.

function SC_activeSeq() {
    if (!app.project || !app.project.activeSequence) return "";
    return String(app.project.activeSequence.name);
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
