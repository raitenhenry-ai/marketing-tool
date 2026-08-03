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
let view = "upcoming";

$("#view-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab");
  if (!tab) return;
  view = tab.dataset.view;
  $$(".tab").forEach((t) => t.classList.toggle("active", t === tab));
  render();
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
          </div>
        </div>`).join("")}
    </div>`).join("");
}

function render() {
  if (!data) return;
  const now = Date.now();
  $("#count-upcoming").textContent =
    data.upcoming.filter((c) => c.scheduled_at > now).length || "";
  $("#count-history").textContent = data.history.length || "";
  $("#schedule-host").innerHTML = view === "upcoming" ? renderUpcoming() : renderHistory();
}

async function load() {
  try {
    data = await api("/api/schedule");
    render();
  } catch { /* auth redirect */ }
}

load();
setInterval(load, 10000);
