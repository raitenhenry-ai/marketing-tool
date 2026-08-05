/* Trending Styles: full breakdown of every video style with benchmarks,
   how often you've used it, and a create shortcut per style. */

import {
  $, $$, icons, STYLES, photoImg, api, toast, initShell, openCreateModal, spark,
} from "./shell.js";

initShell({
  title: "Trending Video Styles",
  sub: "What's performing best right now, and how each angle works.",
});

function render(usage) {
  $("#styles-list").innerHTML = STYLES.map((s, i) => `
    <div class="style-full">
      <div class="style-thumb ${s.g}" style="position:relative">
        ${icons[s.icon]}
        ${photoImg(s.photo)}
        <span class="style-rank" style="top:8px;left:8px">#${i + 1}</span>
        <span class="style-views">${icons.play} ${s.views}</span>
      </div>
      <div>
        <span class="style-tag ${s.tag[0]}">${s.tag[1]}</span>
        <h3>${s.name}</h3>
        <p>${s.long}</p>
        <div class="bench">
          <span class="bench-chip">${icons.eye} Avg views <b>${s.views}</b></span>
          <span class="bench-chip">${icons.heart} Best for <b>${s.tag[1].replace("High ", "").toLowerCase()}</b></span>
          <span class="bench-chip">${icons.film} You used it <b>${usage[s.key] || 0}×</b></span>
        </div>
        ${spark(s.sparkline, "blue")}
        <div style="margin-top:12px">
          <button class="btn btn-primary btn-sm" data-create="${s.key}">
            ${icons.sparkle} Create with this style
          </button>
        </div>
      </div>
    </div>`).join("");
}

$("#styles-list").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-create]");
  if (btn) openCreateModal(btn.dataset.create);
});

$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("on"));
    t.classList.add("on");
  })
);

async function load() {
  let usage = {};
  try {
    const jobs = await api("/ugc/api/jobs");
    for (const job of jobs) {
      const key = job.settings?.style;
      if (key) usage[key] = (usage[key] || 0) + 1;
    }
  } catch (err) {
    toast(String(err.message || err), "error");
  }
  render(usage);
}

document.addEventListener("ugc:job-created", load);
load();
