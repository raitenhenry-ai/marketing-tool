/* UGC Studio frontend: create jobs, watch them move through the pipeline,
   and see where they got posted. Polls while anything is in flight. */

const $ = (sel, el = document) => el.querySelector(sel);

const PLATFORMS = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
  facebook: "Facebook",
  x: "X",
  threads: "Threads",
  pinterest: "Pinterest",
  linkedin: "LinkedIn",
};

const ACTIVE = ["queued", "scraping", "scripting", "rendering", "posting"];
const STEPS = [
  ["scraping", "Scrape"],
  ["scripting", "Script"],
  ["rendering", "Render"],
  ["posting", "Post"],
];

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (res.status === 401) {
    location.href = "/login";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let toastHost;
function toast(message, type = "success") {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), 4500);
}

/* ---------- Theme + logout ---------- */

$("#theme-btn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("ugc-theme", next);
});

$("#logout-btn").addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  location.href = "/login";
});

/* ---------- Overview (accounts, stats, platform picker) ---------- */

let overview = null;

async function loadOverview() {
  overview = await api("/ugc/api/overview");

  for (const [key, value] of Object.entries(overview.totals)) {
    const el = document.querySelector(`[data-stat="${key}"]`);
    if (el) el.textContent = value;
  }
  $("#foot-accounts").textContent = `${overview.totals.connectedAccounts} account(s) connected`;

  const picks = $("#platform-picks");
  if (!picks.childElementCount) {
    picks.innerHTML = Object.entries(PLATFORMS).map(([key, label]) => {
      const n = overview.accounts[key]?.length || 0;
      const usable = n > 0;
      return `<label class="pick ${usable ? "on" : "off-none"}" data-pick="${key}"
                     title="${usable ? `${n} account(s) connected` : "No account connected - connect one in the ShortForm manager"}">
        <input type="checkbox" value="${key}" ${usable ? "checked" : "disabled"}>
        ${label} <span class="n">${usable ? n : "–"}</span>
      </label>`;
    }).join("");
    picks.addEventListener("click", (e) => {
      const pick = e.target.closest(".pick");
      if (!pick) return;
      const input = pick.querySelector("input");
      if (input.disabled) return;
      setTimeout(() => pick.classList.toggle("on", input.checked));
    });
  }

  const gen = overview.generator;
  $("#gen-hint").innerHTML = gen.heygenConfigured
    ? `Generator: <b>HeyGen avatar</b> — a talking-creator video is rendered from the script.`
    : `Generator: <b>built-in renderer</b> — product images + captions${gen.openaiConfigured
        ? " with an AI voiceover"
        : ""}. ${gen.openaiConfigured ? "" : "Set OPENAI_API_KEY for AI scripts & voiceover, or "}Add HEYGEN_API_KEY for avatar videos.`;
}

/* ---------- Create ---------- */

$("#create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#generate-btn");
  const platforms = [...document.querySelectorAll("#platform-picks input:checked")]
    .map((i) => i.value);
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    await api("/ugc/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        productUrl: $("#product-url").value.trim(),
        tone: $("#tone").value,
        platforms,
        autoPost: $("#auto-post").checked,
      }),
    });
    $("#product-url").value = "";
    toast("On it! Scraping the product page…");
    await refreshJobs();
    document.getElementById("videos").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    toast(String(err.message || err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Generate & post";
  }
});

/* ---------- Jobs ---------- */

function statusBadge(job) {
  const map = {
    queued: ["Queued", "spin"],
    scraping: ["Reading product page…", "spin"],
    scripting: ["Writing script…", "spin"],
    rendering: ["Generating video…", "spin"],
    posting: ["Posting to socials…", "spin"],
    ready: ["Video ready", "ok"],
    posted: ["Posted", "ok"],
    failed: ["Failed", "err"],
  };
  const [label, cls] = map[job.status] || [job.status, ""];
  return `<span class="badge ${cls}">${label}</span>`;
}

function stepsBar(job) {
  const reached = {
    scraping: 0, scripting: 1, rendering: 2, posting: 3,
    ready: 3, posted: 4, failed: -1, queued: -0.5,
  }[job.status];
  return `<div class="steps">${STEPS.map(([key, label], i) => {
    let cls = "";
    if (job.status === key) cls = "now";
    else if (reached > i || job.status === "posted" || (job.status === "ready" && i < 3)) cls = "done";
    return `<span class="step ${cls}">${label}</span>${i < STEPS.length - 1 ? '<span class="step-arrow">→</span>' : ""}`;
  }).join("")}</div>`;
}

function postBadges(job) {
  if (!job.posts.length) return "";
  return `<div class="post-badges">${job.posts.map((p) => {
    const label = PLATFORMS[p.platform] || p.platform;
    const who = p.accountName ? ` · ${esc(p.accountName)}` : "";
    const cls = p.status === "done" ? "ok" : p.status === "failed" ? "err" : "warn";
    const inner = `<span class="badge ${cls}" title="${esc(p.error || "")}">${label}${who} — ${p.status}</span>`;
    return p.url ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">${inner}</a>` : inner;
  }).join("")}</div>`;
}

function jobCard(job) {
  const p = job.product;
  const img = p?.images?.[0];
  const media = job.videoUrl
    ? `<video src="${esc(job.videoUrl)}" controls playsinline preload="metadata"></video>`
    : img
      ? `<img src="${esc(img)}" alt="" loading="lazy">`
      : `<div class="placeholder">🎬</div>`;

  const script = job.script
    ? `<div class="job-script"><b>“${esc(job.script.hook)}”</b><br>
         ${esc(job.script.caption || "")}<br>
         <span class="hashtags">${esc((job.script.hashtags || []).join(" "))}</span></div>`
    : "";

  const failedPosts = job.posts.filter((x) => x.status === "failed").length;
  const actions = [];
  if (job.status === "failed") {
    actions.push(`<button class="btn-small" data-act="retry" data-id="${job.id}">↻ Retry</button>`);
  }
  if (job.videoUrl && ["ready", "posted"].includes(job.status)) {
    if (failedPosts) {
      actions.push(`<button class="btn-small" data-act="post-failed" data-id="${job.id}">↻ Retry ${failedPosts} failed post(s)</button>`);
    }
    actions.push(`<button class="btn-small" data-act="post" data-id="${job.id}">🚀 Post now</button>`);
    actions.push(`<a class="btn-small" style="text-decoration:none" href="${esc(job.videoUrl)}" download>⬇ Download</a>`);
    actions.push(`<button class="btn-small" data-act="regen" data-id="${job.id}">✨ Regenerate</button>`);
  }
  actions.push(`<button class="btn-small danger" data-act="delete" data-id="${job.id}">🗑 Delete</button>`);

  return `<article class="job" data-job="${job.id}">
    <div class="job-media">${media}</div>
    <div>
      <div class="job-head">
        <div>
          <p class="job-title">${esc(p?.name || job.productUrl)}</p>
          <a class="job-url" href="${esc(job.productUrl)}" target="_blank" rel="noopener">${esc(job.productUrl)}</a>
        </div>
        ${statusBadge(job)}
      </div>
      ${stepsBar(job)}
      ${script}
      ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ""}
      ${postBadges(job)}
      <div class="job-actions">${actions.join("")}</div>
    </div>
  </article>`;
}

let pollTimer = null;

async function refreshJobs() {
  const jobs = await api("/ugc/api/jobs");
  const host = $("#jobs");

  if (!jobs.length) {
    host.innerHTML = `<div class="empty">No videos yet — paste a product URL above and hit
      <b>Generate</b>. The whole thing runs on its own from there.</div>`;
  } else {
    // Skip re-rendering while a video is playing so playback isn't reset.
    const playing = [...host.querySelectorAll("video")].some((v) => !v.paused && !v.ended);
    if (!playing) host.innerHTML = jobs.map(jobCard).join("");
  }

  const active = jobs.filter((job) => ACTIVE.includes(job.status)).length;
  $("#jobs-hint").textContent = active
    ? `${active} job(s) in progress — updating live`
    : `${jobs.length} video(s)`;

  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => refreshJobs().catch(() => {}), active ? 4000 : 30000);
  if (active) loadOverview().catch(() => {});
}

$("#jobs").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn || btn.tagName === "A") return;
  const { act, id } = btn.dataset;
  btn.disabled = true;
  try {
    if (act === "retry") {
      await api(`/ugc/api/jobs/${id}/retry`, { method: "POST" });
      toast("Retrying the job");
    } else if (act === "post") {
      toast("Posting to your socials…");
      const r = await api(`/ugc/api/jobs/${id}/post`, { method: "POST", body: "{}" });
      toast(`Posted to ${r.posted} account(s)${r.failed ? `, ${r.failed} failed` : ""}`,
        r.failed && !r.posted ? "error" : "success");
    } else if (act === "post-failed") {
      const r = await api(`/ugc/api/jobs/${id}/post`, {
        method: "POST", body: JSON.stringify({ onlyFailed: true }),
      });
      toast(`Retried: ${r.posted} posted, ${r.failed} failed`, r.failed ? "error" : "success");
    } else if (act === "regen") {
      await api(`/ugc/api/jobs/${id}/regenerate`, { method: "POST" });
      toast("Regenerating from scratch");
    } else if (act === "delete") {
      if (!confirm("Delete this video and its post history?")) { btn.disabled = false; return; }
      await api(`/ugc/api/jobs/${id}`, { method: "DELETE" });
      toast("Deleted");
    }
    await refreshJobs();
    await loadOverview();
  } catch (err) {
    toast(String(err.message || err), "error");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Boot ---------- */

const hour = new Date().getHours();
$("#greeting").textContent =
  hour < 5 ? "Late night session 🌙" :
  hour < 12 ? "Good morning 👋" :
  hour < 18 ? "Good afternoon 👋" : "Good evening 👋";

loadOverview().catch((err) => toast(String(err.message || err), "error"));
refreshJobs().catch((err) => {
  $("#jobs").innerHTML = `<div class="empty">Could not load videos: ${esc(err.message || err)}</div>`;
});
