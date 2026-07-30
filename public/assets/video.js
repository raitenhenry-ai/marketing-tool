import {
  $, api, initShell, icons, esc, toast, confirmDialog, statusBadge,
  fmtDateTime, fmtDuration, relTime, uploadChip, fmtCompact, PLATFORMS,
} from "./common.js";

const id = new URLSearchParams(location.search).get("id");

initShell({ title: "Video", crumb: { href: "videos.html", label: "Videos" } });

if (!id) location.href = "videos.html";

document.addEventListener("click", async (e) => {
  if (e.target.closest("#retry-btn")) {
    try {
      await api(`/api/videos/${id}/reprocess`, { method: "POST" });
      toast("Re-queued for processing");
      load();
    } catch (err) { toast(err.message, "error"); }
  }
  if (e.target.closest("#delete-btn")) {
    const ok = await confirmDialog({
      title: "Delete this video?",
      message: "This removes the video, all its clips and files from this server. Posts already published to the platforms stay up.",
    });
    if (!ok) return;
    try {
      await api(`/api/videos/${id}`, { method: "DELETE" });
      toast("Video deleted");
      location.href = "videos.html";
    } catch (err) { toast(err.message, "error"); }
  }
});

function clipCard(c, video) {
  const manual = video.publishMode !== "auto";
  const due = c.scheduledAt <= Date.now();
  const scheduleLine = manual || c.uploads.length
    ? ""
    : due
      ? `<span class="badge scheduled"><span class="bdot"></span>publish window open</span>`
      : `<span class="clip-when">${icons.clock} ${relTime(c.scheduledAt)} · ${fmtDateTime(c.scheduledAt)}</span>`;
  const partPad = String(c.part).padStart(2, "0");
  const downloadName = `Part ${partPad} of ${String(c.totalParts).padStart(2, "0")}${c.genTitle ? ` - ${c.genTitle.replace(/[<>:"/\\|?*]/g, "")}` : ""}.mp4`;

  const hashtags = c.genHashtags?.length
    ? `<div>${c.genHashtags.slice(0, 8).map((h) => `<span class="hashtag">${esc(h)}</span>`).join("")}</div>`
    : "";

  const links = c.uploads
    .filter((u) => u.platform === "youtube" && u.status === "done" && u.platformVideoId)
    .map((u) => `<a href="https://youtu.be/${encodeURIComponent(u.platformVideoId)}" target="_blank" rel="noopener">
        watch on YouTube ${icons.external}</a>`)
    .join("");

  return `<div class="clip-card">
    <div class="clip-player">
      <video src="${c.url}" controls preload="metadata"></video>
    </div>
    <div class="clip-body">
      <div class="clip-head">
        <span class="clip-part">Part ${c.part}/${c.totalParts}</span>
        <span class="flex" style="gap:6px">
          <span class="muted" style="font-size:12px">${fmtDuration(c.durationSeconds)}</span>
          <a class="icon-btn" title="Download this clip" href="${c.url}" download="${esc(downloadName)}">${icons.download}</a>
        </span>
      </div>
      ${c.genTitle ? `<div class="clip-gen-title" title="${esc(c.genDescription || "")}">“${esc(c.genTitle)}”</div>` : ""}
      ${hashtags}
      ${scheduleLine}
      <div class="clip-uploads">${c.uploads.map(uploadChip).join("")}</div>
      ${c.uploads.some((u) => u.metrics) ? `
        <div class="muted" style="font-size:12px">
          ${c.uploads.filter((u) => u.metrics).map((u) =>
            `${PLATFORMS[u.platform]}: ${fmtCompact(u.metrics.views)} views · ${fmtCompact(u.metrics.likes)} likes · ${fmtCompact(u.metrics.comments)} comments`
          ).join("<br>")}
        </div>` : ""}
      ${links ? `<div style="font-size:12.5px;display:flex;gap:4px;align-items:center">${links}</div>` : ""}
    </div>
  </div>`;
}

async function load() {
  let v;
  try {
    v = await api(`/api/videos/${id}`);
  } catch (err) {
    $("#video-head").innerHTML = `<div class="empty">${icons.alert}<h3>Video not found</h3>
      <p>It may have been deleted.</p><a class="btn btn-secondary" href="videos.html">Back to videos</a></div>`;
    $("#clips-host").innerHTML = "";
    return;
  }

  document.title = `${v.title} · ShortForm Manager`;

  const manual = v.publishMode !== "auto";
  const accounts = manual
    ? `<span class="badge">download only — nothing is auto-posted</span>`
    : v.accounts.length
      ? v.accounts.map((a) =>
          `<span class="chip"><span class="pdot ${a.platform}"></span>${PLATFORMS[a.platform]} · ${esc(a.account_name)}</span>`).join(" ")
      : `<span class="muted" style="font-size:13px">Accounts are assigned when the first part publishes.</span>`;

  $("#video-head").innerHTML = `
    <div class="flex" style="align-items:flex-start; gap:16px; flex-wrap:wrap">
      <div style="min-width:0">
        <div class="flex mb-8" style="gap:10px">
          <h2 style="font-size:18px; font-weight:750; letter-spacing:-0.01em">${esc(v.title)}</h2>
          ${statusBadge(v.status)}
        </div>
        <div class="muted" style="font-size:13px">
          ${esc(v.originalFilename)} · ${fmtDuration(v.durationSeconds)} ·
          uploaded ${fmtDateTime(v.createdAt)}
          ${v.cuts ? " · custom cuts" : ""}
        </div>
        ${v.error ? `<div class="callout mt-8" style="background:var(--danger-soft);border-color:rgba(221,89,89,0.35)">${icons.alert}<span>${esc(v.error)}</span></div>` : ""}
        <div class="mt-8 flex" style="flex-wrap:wrap; gap:8px">${accounts}</div>
      </div>
      <div class="spacer"></div>
      <div class="flex">
        ${v.status === "ready" && v.clips.length
          ? `<a class="btn" href="/api/videos/${v.id}/download.zip">${icons.download} Download ZIP</a>` : ""}
        ${v.status === "failed" ? `<button class="btn btn-secondary" id="retry-btn">${icons.retry} Retry</button>` : ""}
        <button class="btn btn-danger" id="delete-btn">${icons.trash} Delete</button>
      </div>
    </div>`;

  if (v.status === "processing") {
    $("#clips-host").innerHTML = `<div class="card"><div class="empty">
      <span class="badge processing" style="margin-bottom:12px"><span class="bdot"></span>Processing</span>
      <h3>Splitting into clips…</h3>
      <p>Encoding runs one video at a time. This page refreshes automatically.</p>
    </div></div>`;
    return;
  }

  // Don't re-render (and interrupt) clips while one is being watched.
  const watching = [...document.querySelectorAll("#clips-host video")].some((el) => !el.paused);
  if (watching) return;

  $("#clips-host").innerHTML = v.clips.length
    ? `<div class="clip-grid">${v.clips.map((c) => clipCard(c, v)).join("")}</div>`
    : `<div class="card"><div class="empty">${icons.scissors}<h3>No clips</h3>
       <p>Processing produced no clips — check the error above and retry.</p></div></div>`;
}

load();
setInterval(load, 8000);
