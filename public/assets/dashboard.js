import {
  $, api, initShell, icons, esc, fmtDateTime, relTime, uploadChip, PLATFORMS,
} from "/assets/common.js";

initShell({
  title: "Dashboard",
  actions: `<a class="btn" href="/upload.html">${icons.upload} Upload video</a>`,
});

function statTile({ icon, label, value, sub, subClass = "" }) {
  return `<div class="stat">
    <div class="stat-label">${icons[icon]}${label}</div>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub ${subClass}">${sub}</div>` : ""}
  </div>`;
}

async function render() {
  let stats;
  try {
    stats = await api("/api/stats");
  } catch {
    return;
  }
  const t = stats.totals;

  $("#stat-tiles").innerHTML = [
    statTile({
      icon: "film", label: "Videos", value: t.videos,
      sub: t.processingVideos
        ? `${t.processingVideos} processing now`
        : t.failedVideos ? `${t.failedVideos} failed — needs attention` : "all processed",
      subClass: t.failedVideos ? "bad" : t.processingVideos ? "" : "good",
    }),
    statTile({
      icon: "scissors", label: "Clips created", value: t.clips,
      sub: `${t.scheduled} still scheduled`,
    }),
    statTile({
      icon: "send", label: "Published posts", value: t.published,
      sub: t.failedUploads ? `${t.failedUploads} gave up after retries` : "no failed uploads",
      subClass: t.failedUploads ? "bad" : "good",
    }),
    statTile({
      icon: "accounts", label: "Connected accounts", value: t.accounts,
      sub: ["youtube", "instagram", "tiktok"]
        .map((p) => `${stats.accountsByPlatform[p] || 0} ${PLATFORMS[p]}`)
        .join(" · "),
    }),
  ].join("");

  $("#queue-hint").textContent = stats.queueDepth
    ? `${stats.queueDepth} video(s) in the encode queue`
    : "";

  const next = stats.nextPublishes;
  $("#next-publishes").innerHTML = next.length
    ? next.map((c) => `
        <div class="tl-item">
          <span class="tl-time" title="${fmtDateTime(c.scheduled_at)}">${relTime(c.scheduled_at)}</span>
          <div class="tl-body">
            <div class="tl-title"><a href="/video.html?id=${c.video_id}">${esc(c.gen_title || c.title)}</a></div>
            <div class="tl-sub">Part ${c.part_number}/${c.total_parts} · ${fmtDateTime(c.scheduled_at)}</div>
          </div>
        </div>`).join("")
    : `<div class="empty">${icons.schedule}<h3>Nothing scheduled</h3>
       <p>Upload a long-form video and its parts will be scheduled automatically.</p>
       <a class="btn" href="/upload.html">Upload a video</a></div>`;

  const recent = stats.recentUploads;
  $("#recent-activity").innerHTML = recent.length
    ? recent.map((u) => `
        <div class="tl-item">
          <div class="tl-body">
            <div class="tl-title"><a href="/video.html?id=${u.video_id}">${esc(u.title)}</a>
              <span class="muted">· Part ${u.part_number}/${u.total_parts}</span></div>
            <div class="tl-sub">${u.uploaded_at ? fmtDateTime(u.uploaded_at) : "in progress"}</div>
          </div>
          <div class="tl-side">${uploadChip(u)}</div>
        </div>`).join("")
    : `<div class="empty">${icons.send}<h3>No uploads yet</h3>
       <p>Once clips reach their scheduled time they're published to every connected account and show up here.</p></div>`;

  try {
    const accounts = await api("/api/accounts");
    $("#platform-summary").innerHTML = Object.entries(accounts.platforms).map(([key, info]) => {
      const n = info.accounts.length;
      const state = !info.configured
        ? `<span class="on-off off">credentials missing</span>`
        : n === 0
          ? `<a href="/accounts.html">connect →</a>`
          : `<span class="on-off on">${n} connected</span>`;
      return `<span class="chip"><span class="pdot ${key}"></span>${PLATFORMS[key]} ${state}</span>`;
    }).join("");
  } catch { /* shown as-is */ }
}

render();
setInterval(render, 10000);
