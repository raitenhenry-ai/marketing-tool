/* Content: every video with status filters and search. */

import {
  $, $$, icons, ACTIVE_STATES, esc, api, toast,
  initShell, jobCard, bindJobActions,
} from "./shell.js";

initShell({
  title: "Content",
  sub: "Every UGC video you've generated, and where it went.",
});

const FILTERS = [
  ["all", "All", () => true],
  ["progress", "In progress", (j) => ACTIVE_STATES.includes(j.status)],
  ["ready", "Ready", (j) => j.status === "ready"],
  ["posted", "Published", (j) => j.status === "posted"],
  ["failed", "Failed", (j) => j.status === "failed"],
];

let jobs = [];
let filter = "all";
let query = "";
let pollTimer = null;

function renderFilters() {
  $("#filters").innerHTML = FILTERS.map(([key, label, fn]) => `
    <button class="filter-chip ${filter === key ? "on" : ""}" data-filter="${key}">
      ${label}<span class="n">${jobs.filter(fn).length}</span>
    </button>`).join("") + `
    <label class="search-box">${icons.search}
      <input id="search" type="search" placeholder="Search products…" value="${esc(query)}">
    </label>`;

  $("#search").addEventListener("input", (e) => {
    query = e.target.value.toLowerCase();
    renderJobs();
  });
}

function renderJobs() {
  const fn = FILTERS.find(([key]) => key === filter)[2];
  const visible = jobs.filter(fn).filter((j) =>
    !query ||
    (j.product?.name || "").toLowerCase().includes(query) ||
    j.productUrl.toLowerCase().includes(query));

  const host = $("#jobs");
  if (!visible.length) {
    host.innerHTML = `<div class="empty">${jobs.length
      ? "Nothing matches this filter."
      : "No videos yet — hit <b>Create Content</b> to make your first one."}</div>`;
    return;
  }
  const playing = $$("video", host).some((v) => !v.paused && !v.ended);
  if (!playing) host.innerHTML = visible.map(jobCard).join("");
}

$("#filters").addEventListener("click", (e) => {
  const chip = e.target.closest("[data-filter]");
  if (!chip) return;
  filter = chip.dataset.filter;
  renderFilters();
  renderJobs();
});

async function refresh() {
  jobs = await api("/ugc/api/jobs");
  renderFilters();
  renderJobs();
  const active = jobs.filter((j) => ACTIVE_STATES.includes(j.status)).length;
  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => refresh().catch(() => {}), active ? 4000 : 30000);
}

bindJobActions($("#jobs"), refresh);
document.addEventListener("ugc:job-created", () => refresh().catch(() => {}));

refresh().catch((err) => {
  toast(String(err.message || err), "error");
  $("#jobs").innerHTML = `<div class="empty">Could not load: ${esc(err.message || err)}</div>`;
});
