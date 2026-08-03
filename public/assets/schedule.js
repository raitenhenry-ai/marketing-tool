import {
  $, $$, api, initShell, icons, esc, fmtTime, fmtDay, fmtDateTime,
  uploadChip, toast, PLATFORMS,
} from "./common.js";

initShell({ title: "Schedule" });

$("#retry-failed").innerHTML = `${icons.retry} Retry failed posts`;
$("#retry-failed").addEventListener("click", async (e) => {
  e.target.closest("button").disabled = true;
  try {
    const r = await api("/api/uploads/retry-failed", { method: "POST" });
    toast(r.retried
      ? `${r.retried} failed post(s) re-queued — the scheduler retries them within a minute`
      : "No failed posts to retry");
    load();
  } catch (err) { toast(err.message, "error"); }
  e.target.closest("button").disabled = false;
});

let data = null;
let byAccount = null;
let view = "upcoming";
let platformFilter = "all";

$("#view-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  view = tab.dataset.view;
  $$("#view-tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
  render();
});

document.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-pf]");
  if (!chip) return;
  platformFilter = chip.dataset.pf;
  render();
});

document.addEventListener("click", async (e) => {
  const skip = e.target.closest("[data-skip-clip]");
  if (!skip) return;
  skip.disabled = true;
  try {
    await api(`/api/clips/${skip.dataset.skipClip}/skip`, {
      method: "POST",
      body: JSON.stringify({ accountId: Number(skip.dataset.skipAccount) }),
    });
    toast("Removed from the queue — the line moves up. Undo from the Posted column.");
    load();
  } catch (err) {
    toast(String(err.message || err), "error");
    skip.disabled = false;
  }
});

function groupByDay(items, key) {
  const groups = new Map();
  for (const item of items) {
    const day = new Date(item[key]);
    day.setHours(0, 0, 0, 0);
    const k = day.getTime();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(item);
  }
  return [...groups.entries()];
}

function renderUpcoming() {
  const now = Date.now();
  const upcoming = data.upcoming.filter((c) => {
    const donePlatforms = c.uploads.filter((u) => u.status === "done").length;
    return c.scheduled_at > now || (donePlatforms === 0 && c.scheduled_at > now - 3600000);
  });

  if (!upcoming.length) {
    return `<div class="card"><div class="empty">${icons.schedule}
      <h3>Nothing scheduled</h3>
      <p>Upload a video and its parts will appear here, spaced out automatically.</p>
      <a class="btn" href="upload.html">Upload a video</a></div></div>`;
  }

  return groupByDay(upcoming, "scheduled_at").map(([day, items]) => `
    <div class="day-group">
      <div class="day-head">${fmtDay(Number(day))}</div>
      ${items.map((c) => `
        <div class="tl-item">
          <span class="tl-time">${fmtTime(c.scheduled_at)}</span>
          <div class="tl-body">
            <div class="tl-title"><a href="video.html?id=${c.video_id}">${esc(c.gen_title || c.title)}</a></div>
            <div class="tl-sub">${esc(c.title)} · Part ${c.part_number}/${c.total_parts}</div>
          </div>
          <div class="tl-side">
            ${c.uploads.length
              ? c.uploads.map(uploadChip).join("")
              : `<span class="badge scheduled"><span class="bdot"></span>scheduled</span>`}
          </div>
        </div>`).join("")}
    </div>`).join("");
}

function renderHistory() {
  if (!data.history.length) {
    return `<div class="card"><div class="empty">${icons.send}
      <h3>No publish history yet</h3>
      <p>Every attempt to publish a clip — success or failure — is recorded here.</p></div></div>`;
  }
  return groupByDay(data.history, "uploaded_at").map(([day, items]) => `
    <div class="day-group">
      <div class="day-head">${fmtDay(Number(day))}</div>
      ${items.map((u) => `
        <div class="tl-item">
          <span class="tl-time">${u.uploaded_at ? fmtTime(u.uploaded_at) : "—"}</span>
          <div class="tl-body">
            <div class="tl-title"><a href="video.html?id=${u.video_id}">${esc(u.title)}</a>
              <span class="muted">· Part ${u.part_number}/${u.total_parts}</span></div>
            <div class="tl-sub">
              ${PLATFORMS[u.platform] || u.platform}${u.account_name ? ` · ${esc(u.account_name)}` : ""}
              ${u.attempts > 1 ? ` · ${u.attempts} attempts` : ""}
              ${u.error ? ` · <span style="color:var(--danger)">${esc(u.error.slice(0, 140))}</span>` : ""}
            </div>
          </div>
          <div class="tl-side">
            <span class="badge ${u.status}"><span class="bdot"></span>${u.status}</span>
            ${u.url
              ? `<a class="icon-btn" href="${esc(u.url)}" target="_blank" rel="noopener" title="View the post on ${PLATFORMS[u.platform] || u.platform}">${icons.external}</a>`
              : ""}
            ${u.status === "failed" && u.upload_id
              ? `<button class="icon-btn" data-retry-upload="${u.upload_id}" title="Retry this post now">${icons.retry}</button>`
              : ""}
          </div>
        </div>`).join("")}
    </div>`).join("");
}

function gapText(h) {
  if (h <= 0) return "default schedule — each part at its timeline slot";
  if (h < 1) return `posts every ${Math.round(h * 60)} min`;
  return h === 1 ? "posts every hour" : `posts every ${h} hours`;
}

function accountCard(a) {
  const now = byAccount.now;
  const upcoming = a.upcoming.slice(0, 10);
  const posted = a.posted.slice(0, 10);
  const doneCount = a.posted.filter((p) => p.status === "done").length;
  return `<div class="card mb-16">
    <div class="flex" style="margin-bottom:6px">
      <span class="platform-logo ${a.platform}">${icons[a.platform]}</span>
      <div>
        <div class="row-title">${esc(a.name || "account")}</div>
        <div class="row-sub">${PLATFORMS[a.platform] || a.platform} · ${gapText(a.minGapHours)}</div>
      </div>
      <div class="spacer"></div>
      <span class="badge scheduled"><span class="bdot"></span>${a.upcoming.length} queued</span>
      <span class="badge done"><span class="bdot"></span>${doneCount} posted</span>
    </div>
    <div class="acct-grid">
      <div>
        <div class="mini-head">Coming up${a.minGapHours > 0 ? ` <span style="text-transform:none;font-weight:400">(≈ forecast at this cadence)</span>` : ""}</div>
        ${upcoming.length ? upcoming.map((u) => `
          <div class="mini-row">
            <span class="mini-time">${u.plannedAt <= now
              ? "due now"
              : `${u.estimated ? "≈ " : ""}${fmtDateTime(u.plannedAt)}`}</span>
            <span class="truncate"><a href="video.html?id=${u.videoId}">${esc(u.genTitle || u.videoTitle)}</a></span>
            <span class="muted nowrap">Part ${u.part}/${u.totalParts}${u.retry ? " · retry" : ""}</span>
            <button class="icon-btn danger" style="margin-left:auto;width:22px;height:22px"
              data-skip-clip="${u.clipId}" data-skip-account="${a.id}"
              title="Remove from this account's queue (won't post; the line moves up)">✕</button>
          </div>`).join("") : `<div class="mini-row muted">nothing queued</div>`}
        ${a.upcoming.length > 10 ? `<div class="mini-row muted">+ ${a.upcoming.length - 10} more</div>` : ""}
      </div>
      <div>
        <div class="mini-head">Posted</div>
        ${posted.length ? posted.map((u) => `
          <div class="mini-row">
            <span class="mini-time">${u.uploaded_at ? fmtDateTime(u.uploaded_at) : "—"}</span>
            <span class="truncate"><a href="video.html?id=${u.video_id}">${esc(u.gen_title || u.video_title)}</a></span>
            <span class="muted nowrap">Part ${u.part}/${u.total_parts}</span>
            <span class="badge ${u.status}" style="margin-left:auto"><span class="bdot"></span>${u.status}</span>
            ${u.url ? `<a class="icon-btn" href="${esc(u.url)}" target="_blank" rel="noopener" title="View the post">${icons.external}</a>` : ""}
            ${(u.status === "failed" || u.status === "skipped") && u.upload_id
              ? `<button class="icon-btn" data-retry-upload="${u.upload_id}" title="${u.status === "skipped" ? "Put back in the queue" : "Retry this post now"}">${icons.retry}</button>`
              : ""}
          </div>`).join("") : `<div class="mini-row muted">nothing posted yet</div>`}
      </div>
    </div>
  </div>`;
}

function renderAccounts() {
  if (!byAccount) return `<div class="card"><div class="skeleton" style="height:200px"></div></div>`;
  if (!byAccount.accounts.length) {
    return `<div class="card"><div class="empty">${icons.accounts}
      <h3>No accounts connected</h3>
      <p>Connect accounts and every one gets its own queue and history here.</p>
      <a class="btn" href="accounts.html">Open Accounts</a></div></div>`;
  }
  const present = [...new Set(byAccount.accounts.map((a) => a.platform))];
  const chips = `<div class="tabs mb-16">
    <button class="tab ${platformFilter === "all" ? "active" : ""}" data-pf="all">All platforms</button>
    ${present.map((pf) => `
      <button class="tab ${platformFilter === pf ? "active" : ""}" data-pf="${pf}">
        <span class="pdot ${pf}"></span> ${PLATFORMS[pf] || pf}
      </button>`).join("")}
  </div>`;
  const accs = byAccount.accounts.filter((a) => platformFilter === "all" || a.platform === platformFilter);
  return chips + (accs.length
    ? accs.map(accountCard).join("")
    : `<div class="card"><div class="empty"><h3>No accounts on this platform</h3></div></div>`);
}

function render() {
  if (!data) return;
  const now = Date.now();
  $("#count-upcoming").textContent =
    data.upcoming.filter((c) => c.scheduled_at > now).length || "";
  $("#count-history").textContent = data.history.length || "";
  $("#count-accounts").textContent = byAccount?.accounts.length || "";
  $("#schedule-host").innerHTML =
    view === "upcoming" ? renderUpcoming() : view === "accounts" ? renderAccounts() : renderHistory();
}

async function load() {
  try {
    [data, byAccount] = await Promise.all([
      api("/api/schedule"),
      api("/api/schedule/accounts"),
    ]);
    render();
  } catch { /* auth redirect */ }
}

load();
setInterval(load, 10000);
