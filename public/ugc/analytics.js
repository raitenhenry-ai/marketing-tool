/* Analytics: totals, per-platform breakdown, and the full post log. */

import {
  $, $$, icons, PLATFORMS, esc, fmtDateTime, api, toast,
  getOverview, initShell, spark, dailySeries, deltaChip,
} from "./shell.js";

initShell({
  title: "Analytics",
  sub: "How your UGC pipeline is performing across platforms.",
});

$$("[data-ico]").forEach((el) => { el.innerHTML = icons[el.dataset.ico] || ""; });

function windowCounts(timestamps) {
  const now = Date.now(), week = 7 * 86400000;
  let current = 0, previous = 0;
  for (const t of timestamps) {
    if (t > now - week) current++;
    else if (t > now - 2 * week) previous++;
  }
  return [current, previous];
}

function pad(series) {
  return series.every((v) => !v) ? [1, 2, 1.6, 2.4, 2, 2.8, 2.4] : series;
}

function renderStats(overview, jobs) {
  const t = overview.totals;
  const tiles = $$("#stat-tiles .stat");
  const createdTs = jobs.filter((j) => j.videoUrl).map((j) => j.createdAt);
  const postedTs = jobs.flatMap((j) =>
    j.posts.filter((p) => p.status === "done" && p.postedAt).map((p) => p.postedAt));
  const attempts = t.posted + t.failedPosts;

  const fill = (tile, value, delta, series, cls) => {
    tile.querySelector(".stat-value").textContent = value;
    tile.querySelector(".delta")?.remove();
    tile.querySelector(".spark")?.remove();
    tile.insertAdjacentHTML("beforeend", delta + spark(series, cls));
  };

  fill(tiles[0], t.videosReady, deltaChip(...windowCounts(createdTs)), pad(dailySeries(createdTs)), "blue");
  fill(tiles[1], t.posted, deltaChip(...windowCounts(postedTs)), pad(dailySeries(postedTs)), "purple");
  fill(tiles[2], t.failedPosts,
    t.failedPosts
      ? `<span class="delta down">${icons.trendUp} needs a retry</span>`
      : `<span class="delta up">${icons.trendUp} all clear</span>`,
    pad([0, 0, 0, 0, 0, 0, t.failedPosts]), t.failedPosts ? "gray" : "green");
  fill(tiles[3], attempts ? `${Math.round((t.posted / attempts) * 100)}%` : "—",
    `<span class="delta flat">${attempts} post attempt(s) total</span>`,
    pad(dailySeries(postedTs)), "green");
}

function renderPlatformTable(overview, jobs) {
  const byPlatform = {};
  for (const job of jobs) {
    for (const post of job.posts) {
      byPlatform[post.platform] ??= { done: 0, failed: 0, pending: 0 };
      if (post.status === "done") byPlatform[post.platform].done++;
      else if (post.status === "failed") byPlatform[post.platform].failed++;
      else byPlatform[post.platform].pending++;
    }
  }

  const rows = Object.entries(PLATFORMS)
    .filter(([key]) => (overview.accounts[key]?.length || 0) > 0 || byPlatform[key])
    .map(([key, [label, brand]]) => {
      const s = byPlatform[key] || { done: 0, failed: 0, pending: 0 };
      const total = s.done + s.failed;
      const rate = total ? `${Math.round((s.done / total) * 100)}%` : "—";
      return `<div class="top-row">
        <span class="plat-logo ${key}">${brand}</span>
        <div class="top-meta">
          <div class="top-name"><span class="t">${label}</span></div>
          <div class="top-sub">${overview.accounts[key]?.length || 0} account(s) connected</div>
        </div>
        <div class="top-num" style="margin-right:18px"><b>${s.done}</b><small>published</small></div>
        <div class="top-num" style="margin-right:18px"><b>${s.failed}</b><small>failed</small></div>
        <div class="top-num"><b>${rate}</b><small>success</small></div>
      </div>`;
    });

  $("#platform-table").innerHTML = rows.join("") ||
    `<div class="empty small">No accounts connected yet —
       <a class="link" href="/343k/accounts.html">connect socials</a> to start posting.</div>`;
}

function renderPosts(jobs) {
  const rows = [];
  for (const job of jobs) {
    for (const post of job.posts) {
      rows.push({ job, post });
    }
  }
  rows.sort((a, b) => (b.post.postedAt || b.job.updatedAt) - (a.post.postedAt || a.job.updatedAt));

  $("#posts-hint").textContent = `${rows.length} post(s) across ${jobs.length} video(s)`;
  if (!rows.length) {
    $("#posts-table").innerHTML = `<div class="empty small">No posts yet —
      generate a video with auto-post on, or hit Post on a ready video.</div>`;
    return;
  }

  $("#posts-table").innerHTML = `<table class="posts">
    <thead><tr>
      <th>Product</th><th>Platform</th><th>Account</th><th>Status</th><th>When</th><th></th>
    </tr></thead>
    <tbody>${rows.slice(0, 100).map(({ job, post }) => `
      <tr>
        <td title="${esc(job.productUrl)}">${esc((job.product?.name || job.productUrl).slice(0, 48))}</td>
        <td><span class="cell-plat">${PLATFORMS[post.platform]?.[1] || ""} ${PLATFORMS[post.platform]?.[0] || post.platform}</span></td>
        <td>${esc(post.accountName || "—")}</td>
        <td><span class="pill ${post.status === "done" ? "ok" : post.status === "failed" ? "err" : "wait"}"
              title="${esc(post.error || "")}">${post.status === "done" ? "Published" : post.status}</span></td>
        <td>${fmtDateTime(post.postedAt)}</td>
        <td>${post.url ? `<a class="link" href="${esc(post.url)}" target="_blank" rel="noopener">View ${icons.external}</a>` : ""}</td>
      </tr>`).join("")}</tbody>
  </table>`;
}

async function load() {
  const [overview, jobs] = await Promise.all([getOverview(true), api("/ugc/api/jobs")]);
  renderStats(overview, jobs);
  renderPlatformTable(overview, jobs);
  renderPosts(jobs);
}

document.addEventListener("ugc:job-created", load);
load().catch((err) => toast(String(err.message || err), "error"));
