import {
  $, api, initShell, icons, esc, toast, fmtCompact, fmtDateTime, relTime, PLATFORMS,
} from "/assets/common.js";

initShell({
  title: "Analytics",
  actions: `<button class="btn btn-secondary" id="refresh-btn">${icons.retry} Refresh metrics</button>`,
});

document.addEventListener("click", async (e) => {
  if (!e.target.closest("#refresh-btn")) return;
  const btn = $("#refresh-btn");
  btn.disabled = true;
  try {
    await api("/api/metrics/refresh", { method: "POST" });
    toast("Refreshing metrics from the platforms — numbers update as they arrive");
    setTimeout(load, 5000);
  } catch (err) {
    toast(err.message, "error");
  } finally {
    setTimeout(() => { btn.disabled = false; }, 5000);
  }
});

function tile(icon, label, value, sub = "") {
  return `<div class="stat">
    <div class="stat-label">${icons[icon]}${label}</div>
    <div class="stat-value">${value}</div>
    ${sub ? `<div class="stat-sub">${sub}</div>` : ""}
  </div>`;
}

const platformChip = (p, name) =>
  `<span class="chip"><span class="pdot ${p}"></span>${PLATFORMS[p]} · ${esc(name || "account")}</span>`;

async function load() {
  let data;
  try {
    data = await api("/api/analytics");
  } catch { return; }

  const t = data.totals;
  const freshness = data.status?.running
    ? "refreshing now…"
    : data.lastFetched
      ? `updated ${relTime(data.lastFetched)}`
      : t.posts
        ? "no metrics fetched yet — hit Refresh"
        : "";

  $("#metric-tiles").innerHTML = [
    tile("videos", "Total views", fmtCompact(t.views), `across ${t.posts} published post(s) · ${freshness}`),
    tile("sparkle", "Likes", fmtCompact(t.likes)),
    tile("captions", "Comments", fmtCompact(t.comments)),
    tile("send", "Shares", fmtCompact(t.shares + t.saves),
      t.saves ? `${fmtCompact(t.shares)} shares · ${fmtCompact(t.saves)} saves` : ""),
  ].join("");

  $("#acc-hint").textContent = t.posts && t.withMetrics < t.posts
    ? `${t.posts - t.withMetrics} post(s) have no metrics yet (accounts may need reconnecting for the new permissions)`
    : "";

  $("#account-rows").innerHTML = data.accounts.map((a) => `
    <tr>
      <td>${platformChip(a.platform, a.accountName)}</td>
      <td class="mono">${a.posts}</td>
      <td class="mono">${fmtCompact(a.views)}</td>
      <td class="mono">${fmtCompact(a.likes)}</td>
      <td class="mono">${fmtCompact(a.comments)}</td>
      <td class="mono">${fmtCompact(a.shares + a.saves)}</td>
    </tr>`).join("");
  $("#account-empty").innerHTML = data.accounts.length ? "" :
    `<div class="empty">${icons.accounts}<h3>No published posts yet</h3>
     <p>Once clips publish, per-account performance shows up here.</p></div>`;

  $("#video-rows").innerHTML = data.videos.map((v) => `
    <tr>
      <td>
        <div class="row-title"><a href="/video.html?id=${v.videoId}">${esc(v.title)}</a></div>
        <div class="row-sub">${v.uploads.length} post(s) across ${new Set(v.uploads.map((u) => u.accountName)).size} account(s)</div>
      </td>
      <td class="mono">${v.posts}</td>
      <td class="mono">${fmtCompact(v.views)}</td>
      <td class="mono">${fmtCompact(v.likes)}</td>
      <td class="mono">${fmtCompact(v.comments)}</td>
      <td class="mono">${fmtCompact(v.shares + v.saves)}</td>
    </tr>`).join("");
  $("#video-empty").innerHTML = data.videos.length ? "" :
    `<div class="empty">${icons.videos}<h3>Nothing published yet</h3>
     <p>Per-video totals appear after the first clips go out.</p></div>`;
}

load();
setInterval(load, 15000);
