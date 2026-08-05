/* UGC Studio frontend: dashboard-style UI. Create jobs from the modal,
   watch them move through the pipeline, see per-platform results in the
   analytics rail. Polls while anything is in flight. */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const PLATFORMS = {
  tiktok: ["TikTok", "🎵"],
  instagram: ["Instagram", "📸"],
  youtube: ["YouTube", "▶"],
  facebook: ["Facebook", "👍"],
  x: ["X", "𝕏"],
  threads: ["Threads", "@"],
  pinterest: ["Pinterest", "📌"],
  linkedin: ["LinkedIn", "in"],
};

const STYLES = [
  { key: "product_pov", name: "Product POV", desc: "Show the product in real life situations.", tag: ["eng", "High Engagement"], emoji: "🤳", g: "g1" },
  { key: "grwm", name: "Get Ready With Me", desc: "Include your product in your routine.", tag: ["eng", "High Engagement"], emoji: "💄", g: "g2" },
  { key: "unboxing", name: "Unboxing", desc: "Satisfying unboxing with reveal.", tag: ["views", "High Views"], emoji: "📦", g: "g3" },
  { key: "before_after", name: "Before / After", desc: "Show transformation or results.", tag: ["conv", "High Conversion"], emoji: "✨", g: "g4" },
  { key: "demo", name: "Product Demo", desc: "Quick demo of how it works.", tag: ["conv", "High Conversion"], emoji: "🎬", g: "g5" },
];

const ACTIVE = ["queued", "scraping", "scripting", "rendering", "posting"];

function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDay(ms) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
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

/* ---------- Header, theme, logout, nav ---------- */

const hour = new Date().getHours();
$("#greeting").textContent =
  hour < 5 ? "Late night session 🌙" :
  hour < 12 ? "Good morning 👋" :
  hour < 18 ? "Good afternoon 👋" : "Good evening 👋";
$("#date-chip").textContent = "📅 " + new Date().toLocaleDateString([], {
  weekday: "short", month: "short", day: "numeric", year: "numeric",
});

$("#theme-btn").addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  document.documentElement.dataset.theme = next;
  localStorage.setItem("ugc-theme", next);
});

$("#logout-btn").addEventListener("click", async () => {
  await fetch("/logout", { method: "POST" });
  location.href = "/login";
});

// Highlight the in-page nav item that was clicked.
$$("[data-nav]").forEach((a) =>
  a.addEventListener("click", () => {
    $$("[data-nav]").forEach((x) => x.classList.remove("active"));
    a.classList.add("active");
  })
);

// Decorative platform tabs on the styles card.
$$(".tab").forEach((t) =>
  t.addEventListener("click", () => {
    $$(".tab").forEach((x) => x.classList.remove("on"));
    t.classList.add("on");
  })
);

/* ---------- Trending styles (selectable) ---------- */

let selectedStyle = "product_pov";

function renderStyles() {
  $("#styles-row").innerHTML = STYLES.map((s, i) => `
    <div class="style-card ${s.key === selectedStyle ? "on" : ""}" data-style="${s.key}">
      <span class="style-rank">#${i + 1}</span>
      <span class="style-check">✓</span>
      <div class="style-thumb ${s.g}">${s.emoji}</div>
      <div class="style-name">${s.name}</div>
      <div class="style-desc">${s.desc}</div>
      <span class="style-tag ${s.tag[0]}">${s.tag[1]}</span>
    </div>`).join("");
}
renderStyles();

$("#styles-row").addEventListener("click", (e) => {
  const card = e.target.closest("[data-style]");
  if (!card) return;
  selectedStyle = card.dataset.style;
  renderStyles();
  const style = STYLES.find((s) => s.key === selectedStyle);
  $("#style-chip").textContent = style.name;
});

/* ---------- Overview (stats, plan card, analytics rail) ---------- */

let overview = null;

function railPlatformRows(jobs) {
  const byPlatform = {};
  for (const job of jobs || []) {
    for (const post of job.posts) {
      byPlatform[post.platform] ??= { done: 0, failed: 0 };
      if (post.status === "done") byPlatform[post.platform].done++;
      if (post.status === "failed") byPlatform[post.platform].failed++;
    }
  }
  const rows = Object.entries(PLATFORMS)
    .filter(([key]) => (overview?.accounts[key]?.length || 0) > 0 || byPlatform[key])
    .map(([key, [label, emoji]]) => {
      const accounts = overview?.accounts[key]?.length || 0;
      const stats = byPlatform[key] || { done: 0, failed: 0 };
      return `<div class="plat-row">
        <div class="plat-logo">${emoji}</div>
        <div class="plat-meta">
          <div class="plat-name">${label}</div>
          <div class="plat-sub">${accounts} account(s)${stats.failed ? ` · ${stats.failed} failed` : ""}</div>
        </div>
        <div class="plat-num">${stats.done}<small>posted</small></div>
      </div>`;
    });
  return rows.join("") ||
    `<div class="empty small">No accounts connected yet.<br>
       <a href="/343k/accounts.html" style="color:var(--accent)">Connect socials →</a></div>`;
}

function railTopContent(jobs) {
  const rows = (jobs || [])
    .filter((job) => job.posts.some((p) => p.status === "done"))
    .slice(0, 6)
    .map((job) => {
      const done = job.posts.filter((p) => p.status === "done");
      const img = job.product?.images?.[0];
      const link = done.find((p) => p.url)?.url;
      const inner = `
        ${img ? `<img class="top-thumb" src="${esc(img)}" alt="" loading="lazy">` : `<div class="top-thumb"></div>`}
        <div class="top-meta">
          <div class="top-name">${esc(job.product?.name || job.productUrl)}</div>
          <div class="top-sub">${fmtDay(job.updatedAt)} · ${done.map((p) => PLATFORMS[p.platform]?.[0] || p.platform).join(", ")}</div>
        </div>
        <div class="top-n">${done.length} post${done.length > 1 ? "s" : ""}</div>`;
      return link
        ? `<a class="top-row" href="${esc(link)}" target="_blank" rel="noopener">${inner}</a>`
        : `<div class="top-row">${inner}</div>`;
    });
  return rows.join("") || `<div class="empty small">Nothing posted yet</div>`;
}

async function loadOverview() {
  overview = await api("/ugc/api/overview");
  const t = overview.totals;

  $('[data-stat="videosReady"]').textContent = t.videosReady;
  $('[data-stat="posted"]').textContent = t.posted;
  $('[data-stat="connectedAccounts"]').textContent = t.connectedAccounts;
  const attempts = t.posted + t.failedPosts;
  $('[data-stat="successRate"]').textContent = attempts
    ? `${Math.round((t.posted / attempts) * 100)}%` : "—";
  $('[data-stat-sub="failedPosts"]').textContent = t.failedPosts
    ? `${t.failedPosts} failed post(s)` : "no failed posts";

  const connectedPlatforms = Object.values(overview.accounts).filter((a) => a.length).length;
  $("#plan-sub").textContent = `${connectedPlatforms} of ${Object.keys(PLATFORMS).length} platforms connected`;
  $("#plan-fill").style.width = `${(connectedPlatforms / Object.keys(PLATFORMS).length) * 100}%`;

  const picks = $("#platform-picks");
  if (!picks.childElementCount) {
    picks.innerHTML = Object.entries(PLATFORMS).map(([key, [label]]) => {
      const n = overview.accounts[key]?.length || 0;
      const usable = n > 0;
      return `<label class="pick ${usable ? "on" : "off-none"}"
                     title="${usable ? `${n} account(s) connected` : "No account connected yet"}">
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
    ? `Generator: <b>HeyGen avatar</b> — a talking-creator video rendered from the script.`
    : `Generator: <b>built-in renderer</b> — product images + captions${gen.openaiConfigured ? " with an AI voiceover" : ""}.`;
}

/* ---------- Create modal ---------- */

const modal = $("#create-modal");
const openModal = () => { modal.hidden = false; setTimeout(() => $("#product-url").focus(), 50); };
const closeModal = () => { modal.hidden = true; };

$("#create-open").addEventListener("click", openModal);
$("#create-open-2").addEventListener("click", openModal);
$("#create-close").addEventListener("click", closeModal);
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.hidden) closeModal(); });

$("#create-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#generate-btn");
  const platforms = $$("#platform-picks input:checked").map((i) => i.value);
  btn.disabled = true;
  btn.textContent = "Starting…";
  try {
    await api("/ugc/api/jobs", {
      method: "POST",
      body: JSON.stringify({
        productUrl: $("#product-url").value.trim(),
        tone: $("#tone").value,
        style: selectedStyle,
        platforms,
        autoPost: $("#auto-post").checked,
      }),
    });
    $("#product-url").value = "";
    closeModal();
    toast("On it! Scraping the product page…");
    await refreshJobs();
    $("#recent").scrollIntoView({ behavior: "smooth" });
  } catch (err) {
    toast(String(err.message || err), "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "✨ Generate & post";
  }
});

/* ---------- Jobs (recent content) ---------- */

const STATE = {
  queued: ["Queued", "spin"],
  scraping: ["Scraping…", "spin"],
  scripting: ["Writing…", "spin"],
  rendering: ["Rendering…", "spin"],
  posting: ["Posting…", "spin"],
  ready: ["Ready", "ok"],
  posted: ["Published", "ok"],
  failed: ["Failed", "err"],
};

function jobCard(job) {
  const p = job.product;
  const img = p?.images?.[0];
  const [label, cls] = STATE[job.status] || [job.status, ""];

  const media = job.videoUrl
    ? `<video src="${esc(job.videoUrl)}" controls playsinline preload="metadata"></video>`
    : img
      ? `<img src="${esc(img)}" alt="" loading="lazy">`
      : `<div class="placeholder">🎬</div>`;

  const postChips = job.posts.slice(0, 4).map((post) => {
    const pc = post.status === "done" ? "ok" : post.status === "failed" ? "err" : "";
    const text = `${PLATFORMS[post.platform]?.[0] || post.platform}`;
    return post.url
      ? `<a class="mini-badge ${pc}" href="${esc(post.url)}" target="_blank" rel="noopener" title="${esc(post.error || "View post")}">${text} ↗</a>`
      : `<span class="mini-badge ${pc}" title="${esc(post.error || post.status)}">${text}</span>`;
  }).join("");

  const failedPosts = job.posts.filter((x) => x.status === "failed").length;
  const actions = [];
  if (job.status === "failed") {
    actions.push(`<button class="mini-btn" data-act="retry" data-id="${job.id}">↻ Retry</button>`);
  }
  if (job.videoUrl && ["ready", "posted"].includes(job.status)) {
    actions.push(`<button class="mini-btn" data-act="post" data-id="${job.id}">🚀 Post</button>`);
    if (failedPosts) {
      actions.push(`<button class="mini-btn" data-act="post-failed" data-id="${job.id}">↻ Failed (${failedPosts})</button>`);
    }
    actions.push(`<a class="mini-btn" href="${esc(job.videoUrl)}" download>⬇</a>`);
    actions.push(`<button class="mini-btn" data-act="regen" data-id="${job.id}">✨ Redo</button>`);
  }
  actions.push(`<button class="mini-btn danger" data-act="delete" data-id="${job.id}">🗑</button>`);

  return `<div class="job">
    <div class="job-thumb">
      <span class="job-state ${cls}">${label}</span>
      ${media}
    </div>
    <div class="job-title" title="${esc(p?.name || job.productUrl)}">${esc(p?.name || job.productUrl)}</div>
    <div class="job-date">${fmtDay(job.createdAt)}${job.script?.hook ? ` · “${esc(job.script.hook.slice(0, 40))}${job.script.hook.length > 40 ? "…" : ""}”` : ""}</div>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ""}
    ${postChips ? `<div class="job-posts">${postChips}</div>` : ""}
    <div class="job-actions">${actions.join("")}</div>
  </div>`;
}

let pollTimer = null;
let lastJobs = [];

async function refreshJobs() {
  const jobs = await api("/ugc/api/jobs");
  lastJobs = jobs;
  const host = $("#jobs");

  if (!jobs.length) {
    host.innerHTML = `<div class="empty">No videos yet — hit <b>＋ Create Content</b>, paste a
      product URL, and the studio does the rest.</div>`;
  } else {
    // Skip re-render while a preview is playing so playback isn't reset.
    const playing = $$("video", host).some((v) => !v.paused && !v.ended);
    if (!playing) host.innerHTML = jobs.map(jobCard).join("");
  }

  $("#platform-overview").innerHTML = railPlatformRows(jobs);
  $("#top-content").innerHTML = railTopContent(jobs);

  const active = jobs.filter((job) => ACTIVE.includes(job.status)).length;
  $("#jobs-hint").textContent = active
    ? `${active} job(s) in progress — updating live`
    : `${jobs.length} video(s)`;

  clearTimeout(pollTimer);
  pollTimer = setTimeout(() => refreshJobs().catch(() => {}), active ? 4000 : 30000);
  // Keep the headline stats in sync while jobs run and when they land.
  if (active || refreshJobs.wasActive) loadOverview().catch(() => {});
  refreshJobs.wasActive = active > 0;
}

$("#jobs").addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
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

loadOverview().catch((err) => toast(String(err.message || err), "error"));
refreshJobs().catch((err) => {
  $("#jobs").innerHTML = `<div class="empty">Could not load videos: ${esc(err.message || err)}</div>`;
});
