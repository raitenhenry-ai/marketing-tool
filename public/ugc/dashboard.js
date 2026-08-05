/* Dashboard: greeting header, stat cards with real weekly deltas,
   trending style picker, recent content, and the analytics rail. */

import {
  $, $$, icons, PLATFORMS, STYLES, ACTIVE_STATES, esc, fmtDay,
  api, toast, getOverview, initShell, openCreateModal,
  jobCard, bindJobActions, spark, dailySeries, deltaChip,
} from "./shell.js";

initShell({ greeting: true, sub: "Here's what's happening with your content today." });

// Fill the static stat-card icons.
$$("[data-ico]").forEach((el) => { el.innerHTML = icons[el.dataset.ico] || ""; });

/* ---------- Trending styles (selectable, feeds the create modal) ---------- */

let selectedStyle = "product_pov";

function renderStyles() {
  $("#styles-row").innerHTML = STYLES.map((s, i) => `
    <div class="style-card ${s.key === selectedStyle ? "on" : ""}" data-style="${s.key}">
      <span class="style-rank">#${i + 1}</span>
      <span class="style-check">${icons.check}</span>
      <div class="style-thumb ${s.g}">
        ${icons[s.icon]}
        <span class="style-views">${icons.play} ${s.views}</span>
      </div>
      <div class="style-name">${s.name}</div>
      <div class="style-desc">${s.desc}</div>
      <span class="style-tag ${s.tag[0]}">${s.tag[1]}</span>
      ${spark(s.sparkline, "blue")}
    </div>`).join("");
}
renderStyles();

$("#styles-row").addEventListener("click", (e) => {
  const card = e.target.closest("[data-style]");
  if (!card) return;
  selectedStyle = card.dataset.style;
  renderStyles();
  openCreateModal(selectedStyle);
});

// Decorative platform tabs.
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("on"));
    t.classList.add("on");
  })
);

/* ---------- Stat cards ---------- */

function windowCounts(timestamps) {
  const now = Date.now(), week = 7 * 86400000;
  let current = 0, previous = 0;
  for (const t of timestamps) {
    if (t > now - week) current++;
    else if (t > now - 2 * week) previous++;
  }
  return [current, previous];
}

function renderStats(overview, jobs) {
  const t = overview.totals;
  const tiles = $$("#stat-tiles .stat");

  const createdTs = jobs.filter((j) => j.videoUrl).map((j) => j.createdAt);
  const postedTs = jobs.flatMap((j) => j.posts.filter((p) => p.status === "done" && p.postedAt).map((p) => p.postedAt));
  const attempts = t.posted + t.failedPosts;
  const rate = attempts ? `${Math.round((t.posted / attempts) * 100)}%` : "—";

  const fill = (tile, value, delta, series, cls) => {
    tile.querySelector(".stat-value").textContent = value;
    tile.querySelector(".delta")?.remove();
    tile.querySelector(".spark")?.remove();
    tile.insertAdjacentHTML("beforeend", delta + spark(series, cls));
  };

  fill(tiles[0], t.videosReady, deltaChip(...windowCounts(createdTs)), pad(dailySeries(createdTs)), "blue");
  fill(tiles[1], t.posted, deltaChip(...windowCounts(postedTs)), pad(dailySeries(postedTs)), "purple");
  fill(tiles[2], t.connectedAccounts,
    `<span class="delta flat">across ${Object.values(overview.accounts).filter((a) => a.length).length} platform(s)</span>`,
    pad([0, 0, 0, 0, 0, 0, t.connectedAccounts]), "blue");
  fill(tiles[3], rate,
    t.failedPosts
      ? `<span class="delta down">${icons.trendUp} ${t.failedPosts} failed post(s)</span>`
      : `<span class="delta up">${icons.trendUp} no failed posts</span>`,
    pad(dailySeries(postedTs)), "green");
}

// Flat-zero series render as a dull baseline; nudge for a visible line.
function pad(series) {
  return series.every((v) => !v) ? [1, 2, 1.6, 2.4, 2, 2.8, 2.4] : series;
}

/* ---------- Analytics rail ---------- */

function railPlatformOverview(overview, jobs) {
  const byPlatform = {};
  for (const job of jobs) {
    for (const post of job.posts) {
      byPlatform[post.platform] ??= { done: 0, failed: 0, ts: [] };
      if (post.status === "done") {
        byPlatform[post.platform].done++;
        if (post.postedAt) byPlatform[post.platform].ts.push(post.postedAt);
      }
      if (post.status === "failed") byPlatform[post.platform].failed++;
    }
  }

  const active = Object.keys(PLATFORMS).filter(
    (k) => (overview.accounts[k]?.length || 0) > 0 || byPlatform[k]);
  if (!active.length) {
    return `<div class="empty small">No accounts connected yet.<br>
      <a class="link" href="/343k/accounts.html">Connect socials ${icons.external}</a></div>`;
  }

  const sections = active.slice(0, 2).map((key) => {
    const [label, brand] = PLATFORMS[key];
    const s = byPlatform[key] || { done: 0, failed: 0, ts: [] };
    const accounts = overview.accounts[key]?.length || 0;
    return `<div class="plat-section">
      <div class="plat-header"><span class="plat-logo ${key}">${brand}</span>
        <span class="plat-name">${label}</span></div>
      <div class="mini-stats">
        <div class="mini-stat"><div class="ms-label">Posts</div><div class="ms-value">${s.done + s.failed}</div></div>
        <div class="mini-stat"><div class="ms-label">Published</div><div class="ms-value">${s.done}</div></div>
        <div class="mini-stat"><div class="ms-label">Failed</div><div class="ms-value">${s.failed}</div></div>
        <div class="mini-stat"><div class="ms-label">Accounts</div><div class="ms-value">${accounts}</div></div>
      </div>
    </div>`;
  }).join("");

  // Dual-line 7-day chart for the two most active platforms.
  const [k1, k2] = active;
  const s1 = dailySeries(byPlatform[k1]?.ts || []);
  const s2 = k2 ? dailySeries(byPlatform[k2]?.ts || []) : null;
  const max = Math.max(...s1, ...(s2 || [0]), 1);
  const line = (s, cls) => {
    const pts = s.map((v, i) => `${(i / (s.length - 1)) * 100},${104 - (v / max) * 92 - 4}`).join(" ");
    return `<polyline class="${cls}" points="${pts}"/>`;
  };
  const days = Array.from({ length: 7 }, (_, i) => fmtDay(Date.now() - (6 - i) * 86400000));

  return sections + `
    <div class="chart-wrap">
      <svg class="chart" viewBox="0 0 100 110" preserveAspectRatio="none">
        <line class="grid-line" x1="0" y1="104" x2="100" y2="104"/>
        <line class="grid-line" x1="0" y1="56" x2="100" y2="56"/>
        <line class="grid-line" x1="0" y1="8" x2="100" y2="8"/>
        ${line(s1, "l1")}${s2 ? line(s2, "l2") : ""}
      </svg>
      <div class="chart-days">${days.map((d) => `<span>${d}</span>`).join("")}</div>
      <div class="legend">
        <span><span class="dot a"></span>${PLATFORMS[k1][0]}</span>
        ${k2 ? `<span><span class="dot b"></span>${PLATFORMS[k2][0]}</span>` : ""}
      </div>
    </div>`;
}

function railTopContent(jobs) {
  const ranked = jobs
    .map((job) => ({ job, done: job.posts.filter((p) => p.status === "done") }))
    .filter((x) => x.done.length)
    .sort((a, b) => b.done.length - a.done.length)
    .slice(0, 4);
  if (!ranked.length) return `<div class="empty small">Nothing posted yet</div>`;

  const max = ranked[0].done.length;
  return ranked.map(({ job, done }, i) => {
    const img = job.product?.images?.[0];
    const link = done.find((p) => p.url)?.url;
    const brand = PLATFORMS[done[0]?.platform]?.[1] || "";
    const inner = `
      <span class="top-rank">${i + 1}</span>
      ${img ? `<img class="top-thumb" src="${esc(img)}" alt="" loading="lazy">` : `<div class="top-thumb"></div>`}
      <div class="top-meta">
        <div class="top-name"><span class="pico">${brand}</span>
          <span class="t">${esc(job.product?.name || job.productUrl)}</span></div>
        <div class="top-sub">${fmtDay(job.updatedAt)}</div>
      </div>
      <div class="top-num"><b>${done.length}</b><small>posts</small>
        <div class="top-bar"><i style="width:${(done.length / max) * 100}%"></i></div>
      </div>`;
    return link
      ? `<a class="top-row" href="${esc(link)}" target="_blank" rel="noopener">${inner}</a>`
      : `<div class="top-row">${inner}</div>`;
  }).join("");
}

/* ---------- Data loop ---------- */

let pollTimer = null;

async function refresh() {
  const [overview, jobs] = await Promise.all([getOverview(true), api("/ugc/api/jobs")]);

  renderStats(overview, jobs);
  $("#platform-overview").innerHTML = railPlatformOverview(overview, jobs);
  $("#top-content").innerHTML = railTopContent(jobs);

  const host = $("#jobs");
  const recent = jobs.slice(0, 4);
  if (!recent.length) {
    host.innerHTML = `<div class="empty">No videos yet — hit <b>Create Content</b>, paste a
      product URL, and the studio does the rest.</div>`;
  } else {
    const playing = $$("video", host).some((v) => !v.paused && !v.ended);
    if (!playing) host.innerHTML = recent.map(jobCard).join("");
  }

  const active = jobs.filter((job) => ACTIVE_STATES.includes(job.status)).length;
  $("#jobs-hint").textContent = active
    ? `${active} job(s) in progress — updating live`
    : `${jobs.length} video(s) total`;

  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => refresh().catch(() => {}), active ? 4000 : 30000);
}

bindJobActions($("#jobs"), refresh);
document.addEventListener("ugc:job-created", () => refresh().catch(() => {}));

refresh().catch((err) => {
  toast(String(err.message || err), "error");
  $("#jobs").innerHTML = `<div class="empty">Could not load: ${esc(err.message || err)}</div>`;
});
