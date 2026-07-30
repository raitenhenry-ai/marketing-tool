import {
  $, $$, api, initShell, icons, esc, toast, confirmDialog,
  statusBadge, fmtDateTime, relTime, skeletonRows, PLATFORMS,
} from "./common.js";

initShell({
  title: "Videos",
  actions: `<a class="btn" href="upload.html">${icons.upload} Upload video</a>`,
});

let videos = [];
let filter = "all";
let search = "";

$("#rows").innerHTML = skeletonRows(6, 5);

$("#status-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  filter = tab.dataset.filter;
  $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  renderRows();
});

$("#search").addEventListener("input", (e) => {
  search = e.target.value.toLowerCase();
  renderRows();
});

document.addEventListener("click", async (e) => {
  const retry = e.target.closest("[data-retry]");
  if (retry) {
    try {
      await api(`/api/videos/${retry.dataset.retry}/reprocess`, { method: "POST" });
      toast("Re-queued for processing");
      load();
    } catch (err) { toast(err.message, "error"); }
    return;
  }
  const del = e.target.closest("[data-del]");
  if (del) {
    const video = videos.find((v) => v.id === Number(del.dataset.del));
    const ok = await confirmDialog({
      title: `Delete “${video?.title || "video"}”?`,
      message: "This removes the video, all its clips and files from this server. Posts already published to the platforms stay up.",
    });
    if (!ok) return;
    try {
      await api(`/api/videos/${del.dataset.del}`, { method: "DELETE" });
      toast("Video deleted");
      load();
    } catch (err) { toast(err.message, "error"); }
  }
});

function nextPublish(v) {
  const now = Date.now();
  const future = v.clips.filter((c) => c.scheduledAt > now).sort((a, b) => a.scheduledAt - b.scheduledAt);
  return future[0] || null;
}

function publishedCount(v) {
  const done = new Set();
  for (const c of v.clips) {
    if (c.uploads.some((u) => u.status === "done")) done.add(c.id);
  }
  return done.size;
}

function renderRows() {
  const counts = { all: videos.length, processing: 0, ready: 0, failed: 0 };
  for (const v of videos) counts[v.status] = (counts[v.status] || 0) + 1;
  for (const key of ["all", "processing", "ready", "failed"]) {
    $(`#count-${key}`).textContent = counts[key] || "";
  }

  const visible = videos.filter((v) =>
    (filter === "all" || v.status === filter) &&
    (!search || v.title.toLowerCase().includes(search)));

  if (!visible.length) {
    $("#rows").innerHTML = "";
    $("#empty-host").innerHTML = `<div class="card mt-16"><div class="empty">
      ${icons.videos}
      <h3>${videos.length ? "No videos match" : "No videos yet"}</h3>
      <p>${videos.length ? "Try a different filter or search." : "Upload a long-form video to get a scheduled series of clips."}</p>
      ${videos.length ? "" : `<a class="btn" href="upload.html">Upload a video</a>`}
    </div></div>`;
    return;
  }
  $("#empty-host").innerHTML = "";

  $("#rows").innerHTML = visible.map((v) => {
    const next = nextPublish(v);
    const pub = publishedCount(v);
    const accounts = v.accounts.length
      ? v.accounts.map((a) =>
          `<span class="chip"><span class="pdot ${a.platform}"></span>${esc(a.account_name)}</span>`).join(" ")
      : `<span class="muted">assigned at first publish</span>`;
    const manual = v.publishMode !== "auto";
    const publishCell = manual
      ? `<span class="badge">download only</span>`
      : next
        ? `<div class="row-title">${relTime(next.scheduledAt)}</div><div class="row-sub">Part ${next.part} · ${fmtDateTime(next.scheduledAt)}</div>`
        : v.status === "ready" ? `<span class="muted">all sent</span>` : `<span class="muted">—</span>`;
    return `<tr>
      <td>
        <div class="row-title"><a href="video.html?id=${v.id}">${esc(v.title)}</a></div>
        <div class="row-sub">${fmtDateTime(v.createdAt)}${v.error ? ` · <span style="color:var(--danger)">${esc(v.error)}</span>` : ""}</div>
      </td>
      <td>${statusBadge(v.status)}</td>
      <td>
        <div class="row-title">${v.clips.length || "—"}</div>
        ${v.clips.length ? `<div class="row-sub">${manual ? `${v.clips.length} to download` : `${pub}/${v.clips.length} published`}</div>` : ""}
      </td>
      <td>${manual ? `<span class="muted">manual</span>` : accounts}</td>
      <td>${publishCell}</td>
      <td class="nowrap">
        ${v.status === "ready" && v.clips.length ? `<a class="icon-btn" title="Download ZIP" href="/api/videos/${v.id}/download.zip">${icons.download}</a>` : ""}
        ${v.status === "failed" ? `<button class="icon-btn" title="Retry processing" data-retry="${v.id}">${icons.retry}</button>` : ""}
        <button class="icon-btn danger" title="Delete" data-del="${v.id}">${icons.trash}</button>
      </td>
    </tr>`;
  }).join("");
}

async function load() {
  try {
    videos = await api("/api/videos");
    renderRows();
  } catch { /* auth redirect */ }
}

load();
setInterval(load, 8000);
