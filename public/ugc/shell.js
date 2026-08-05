/* Shared shell for every UGC Studio page: icons, sidebar + topbar, the
   Create Content modal, API helpers, toasts, and the job card renderer. */

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

/* ---------- Icons (inline SVG, stroke-based - no emojis) ---------- */

const stroke = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;

export const icons = {
  dashboard: stroke('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  grid: stroke('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  flame: stroke('<path d="M12 22c4.4 0 7-2.8 7-6.5 0-3.2-2-5.3-3.5-7C14 6.7 13 5 13 2c-3 2-4.5 4.6-4.5 7 0 1.2.3 2.1.8 3-1-.3-1.9-1-2.4-2C5.6 11.4 5 13 5 15.5 5 19.2 7.6 22 12 22z"/>'),
  folder: stroke('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>'),
  chart: stroke('<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>'),
  users: stroke('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  lock: stroke('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
  link: stroke('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
  logout: stroke('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  calendar: stroke('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'),
  clock: stroke('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  sun: stroke('<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'),
  moon: stroke('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>'),
  plus: stroke('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  film: stroke('<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m10 9 5 3-5 3z"/>'),
  send: stroke('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
  check: stroke('<polyline points="20 6 9 17 4 12"/>'),
  alert: stroke('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  x: stroke('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  download: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>'),
  trash: stroke('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  retry: stroke('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  external: stroke('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  sparkle: stroke('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
  bell: stroke('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>'),
  chevron: stroke('<polyline points="6 9 12 15 18 9"/>'),
  arrowRight: stroke('<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>'),
  trendUp: stroke('<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>'),
  eye: stroke('<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>'),
  heart: stroke('<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>'),
  search: stroke('<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>'),
  camera: stroke('<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>'),
  mirror: stroke('<circle cx="12" cy="8" r="5"/><line x1="12" y1="13" x2="12" y2="21"/><line x1="8" y1="21" x2="16" y2="21"/>'),
  box: stroke('<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/>'),
  wand: stroke('<path d="M15 4V2m0 12v-2m-7-5H6m14 0h-2m-1.8-4.2L17.6 4.4M12.4 9.6 4 18l2 2 8.4-8.4m3.4-3.4-2.2 2.2"/>'),
  play: stroke('<circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/>'),
  youtube: stroke('<path d="M22.5 6.4a3 3 0 0 0-2.1-2.1C18.5 3.8 12 3.8 12 3.8s-6.5 0-8.4.5A3 3 0 0 0 1.5 6.4 31 31 0 0 0 1 12a31 31 0 0 0 .5 5.6 3 3 0 0 0 2.1 2.1c1.9.5 8.4.5 8.4.5s6.5 0 8.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23 12a31 31 0 0 0-.5-5.6z"/><polygon points="10 15 15 12 10 9"/>'),
  instagram: stroke('<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>'),
  tiktok: stroke('<path d="M9 12a4 4 0 1 0 4 4V4c.7 2.3 2.7 4.6 6 5"/>'),
  facebook: stroke('<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>'),
  xbrand: stroke('<path d="M4 4l16 16M20 4L4 20"/>'),
  threads: stroke('<path d="M12 22c-5 0-8-3.5-8-10S7 2 12 2c4.3 0 7 2.4 7.7 6"/><path d="M12 13.5c2.5-1 6-.5 6 2.5s-3 4-5 3.5-3-2.5-2-4.5 4.5-3 6-1"/>'),
  pinterest: stroke('<circle cx="12" cy="12" r="10"/><path d="M9 21c1-3 1.5-5.5 2-8m.5-3.5C11 7 13 6 14.5 7.5s1 4.5-1 5.5-3.5-.5-3-2.5"/>'),
  linkedin: stroke('<rect x="2" y="2" width="20" height="20" rx="3"/><line x1="7" y1="10" x2="7" y2="17"/><circle cx="7" cy="7" r="0.5"/><path d="M11 17v-4a2.5 2.5 0 0 1 5 0v4M11 10v7"/>'),
};

export const PLATFORMS = {
  tiktok: ["TikTok", icons.tiktok],
  instagram: ["Instagram", icons.instagram],
  youtube: ["YouTube", icons.youtube],
  facebook: ["Facebook", icons.facebook],
  x: ["X", icons.xbrand],
  threads: ["Threads", icons.threads],
  pinterest: ["Pinterest", icons.pinterest],
  linkedin: ["LinkedIn", icons.linkedin],
};

// UGC-style photos (Unsplash CDN, free license). Every spot that shows one
// keeps its gradient+icon underneath and drops the <img> on error, so a
// blocked/dead URL just falls back to the flat look.
const U = (id) => `https://images.unsplash.com/${id}?w=480&h=640&fit=crop&q=75&auto=format`;
export const PHOTOS = {
  product_pov: U("photo-1556228720-195a672e8a03"),
  grwm: U("photo-1522335789203-aabd1fc54bc9"),
  unboxing: U("photo-1607082348824-0a96f2a4b9da"),
  before_after: U("photo-1570172619644-dfd03ed5d881"),
  demo: U("photo-1571781926291-c477ebfd024b"),
  generic: U("photo-1596462502278-27bfdc403348"),
};

// Shared fallback-safe photo tag.
export const photoImg = (src, cls = "photo") =>
  src ? `<img class="${cls}" src="${src}" alt="" loading="lazy" onerror="this.remove()">` : "";

export const STYLES = [
  { key: "product_pov", name: "Product POV", desc: "Show the product in real life situations.", tag: ["eng", "High Engagement"], icon: "camera", g: "g1", views: "12.4M", sparkline: [4, 6, 5, 8, 7, 10, 9, 12], photo: PHOTOS.product_pov, long: "The camera is the customer's eyes: the product in hand, on the desk, in the bag - shot like a friend showing you what they bought. Works everywhere and converts on 'relatable' energy." },
  { key: "grwm", name: "Get Ready With Me", desc: "Include your product in your routine.", tag: ["eng", "High Engagement"], icon: "mirror", g: "g2", views: "8.7M", sparkline: [5, 4, 6, 6, 8, 7, 9, 10], photo: PHOTOS.grwm, long: "The product slots naturally into a morning/evening routine. Viewers stay for the routine, discover the product mid-flow - the classic soft-sell format." },
  { key: "unboxing", name: "Unboxing", desc: "Satisfying unboxing with reveal.", tag: ["views", "High Views"], icon: "box", g: "g3", views: "6.1M", sparkline: [3, 5, 4, 7, 6, 8, 7, 9], photo: PHOTOS.unboxing, long: "Package to product in one satisfying arc, with the reveal as the payoff moment. Great for products with strong packaging or a wow first impression." },
  { key: "before_after", name: "Before / After", desc: "Show transformation or results.", tag: ["conv", "High Conversion"], icon: "wand", g: "g4", views: "5.6M", sparkline: [4, 3, 5, 6, 5, 7, 8, 8], photo: PHOTOS.before_after, long: "Opens on the problem, closes on the result. The strongest converting angle when the product produces a visible difference." },
  { key: "demo", name: "Product Demo", desc: "Quick demo of how it works.", tag: ["conv", "High Conversion"], icon: "play", g: "g5", views: "4.2M", sparkline: [2, 4, 3, 5, 6, 5, 7, 8], photo: PHOTOS.demo, long: "Fast, no-fluff walkthrough of what it does and why that's useful. Ideal for gadgets, tools and anything with a clever mechanism." },
];

export const ACTIVE_STATES = ["queued", "scraping", "scripting", "rendering", "posting"];

export const STATE_LABELS = {
  queued: ["Queued", "spin"],
  scraping: ["Scraping…", "spin"],
  scripting: ["Writing…", "spin"],
  rendering: ["Rendering…", "spin"],
  posting: ["Posting…", "spin"],
  ready: ["Ready", "ok"],
  posted: ["Published", "ok"],
  failed: ["Failed", "err"],
};

/* ---------- Helpers ---------- */

export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function fmtDay(ms) {
  return new Date(ms).toLocaleDateString([], { month: "short", day: "numeric" });
}

function dateRangeLabel() {
  const now = Date.now();
  return `${fmtDay(now - 6 * 86400000)} – ${fmtDay(now)}, ${new Date().getFullYear()}`;
}

// Tiny sparkline SVG from a series of numbers.
export function spark(values, cls = "blue") {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const pts = values.map((v, i) =>
    `${(i / (values.length - 1)) * 100},${24 - ((v - min) / range) * 20 - 2}`).join(" ");
  return `<svg class="spark ${cls}" viewBox="0 0 100 26" preserveAspectRatio="none"><polyline points="${pts}"/></svg>`;
}

// Buckets timestamps into daily counts for the last `days` days.
export function dailySeries(timestamps, days = 7) {
  const out = new Array(days).fill(0);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const dayMs = 86400000;
  for (const t of timestamps) {
    const diff = Math.floor((start.getTime() + dayMs - t) / dayMs);
    if (diff >= 0 && diff < days) out[days - 1 - diff]++;
  }
  return out;
}

// "↗ 12.5% vs last 7 days" style delta between two windows.
export function deltaChip(current, previous) {
  if (!current && !previous) return `<span class="delta flat">— vs last 7 days</span>`;
  if (!previous) return `<span class="delta up">${icons.trendUp} new this week</span>`;
  const pct = Math.round(((current - previous) / previous) * 100);
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  const sign = pct > 0 ? "+" : "";
  return `<span class="delta ${cls}">${icons.trendUp} ${sign}${pct}% vs last 7 days</span>`;
}

export function fmtDateTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export async function api(path, options = {}) {
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
export function toast(message, type = "success") {
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

let overviewCache = null;
export async function getOverview(fresh = false) {
  if (!overviewCache || fresh) overviewCache = await api("/ugc/api/overview");
  return overviewCache;
}

/* ---------- Shell (sidebar + topbar + create modal) ---------- */

const NAV = [
  { href: "index.html", icon: "dashboard", label: "Dashboard" },
  { href: "trending.html", icon: "flame", label: "Trending Styles" },
  { href: "content.html", icon: "folder", label: "Content" },
  { href: "analytics.html", icon: "chart", label: "Analytics" },
  { href: "/343k/accounts.html", icon: "users", label: "Accounts" },
  { sep: true },
  { href: "/343k/", icon: "lock", label: "ShortForm Manager" },
  { href: "/hub", icon: "grid", label: "All Tools" },
];

export function initShell({ title, sub, greeting = false } = {}) {
  const path = location.pathname.split("/").pop() || "index.html";

  $("#sidebar").className = "sidebar";
  $("#sidebar").innerHTML = `
    <div class="brand">
      <div class="brand-mark">${icons.sparkle}</div>
      <div class="brand-name">UGC Studio</div>
    </div>
    <button class="create-btn" id="create-open">${icons.plus} Create Content</button>
    <nav class="nav">
      ${NAV.map((item) => item.sep
        ? `<div class="nav-sep"></div>`
        : `<a class="nav-item ${item.href === path ? "active" : ""}" href="${item.href}">
             <span class="ni">${icons[item.icon]}</span> ${item.label}
           </a>`).join("")}
    </nav>
    <div class="plan-card">
      <div class="plan-title">${icons.link} Connections</div>
      <div class="plan-sub" id="plan-sub">— platforms connected</div>
      <div class="plan-bar"><div class="plan-fill" id="plan-fill"></div></div>
      <a class="plan-link" href="/343k/accounts.html">Connect accounts</a>
    </div>
    <div class="user-card">
      <div class="avatar">U</div>
      <div class="user-meta">
        <div class="user-name">Signed in</div>
        <div class="user-sub">operator</div>
      </div>
      <button class="user-out" id="logout-btn" title="Sign out">${icons.logout}</button>
    </div>`;

  const hour = new Date().getHours();
  const hello =
    hour < 5 ? "Late night session 🌙" :
    hour < 12 ? "Good morning 👋" :
    hour < 18 ? "Good afternoon 👋" : "Good evening 👋";

  $("#topbar").className = "topbar";
  $("#topbar").innerHTML = `
    <div>
      <h1>${greeting ? hello : esc(title)}</h1>
      <p class="topbar-sub">${esc(sub || "")}</p>
    </div>
    <div class="topbar-right">
      <div class="chip">${icons.calendar}<span>${dateRangeLabel()}</span>${icons.chevron}</div>
      <button class="icon-btn bell" title="Notifications">${icons.bell}<span class="bell-dot"></span></button>
      <button class="icon-btn" id="theme-btn" title="Toggle light/dark theme"></button>
      <div class="avatar-chip"><div class="avatar sm">U</div>${icons.chevron}</div>
    </div>`;

  const themeBtn = $("#theme-btn");
  const applyThemeIcon = () => {
    themeBtn.innerHTML = document.documentElement.dataset.theme === "light" ? icons.moon : icons.sun;
  };
  applyThemeIcon();
  themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ugc-theme", next);
    applyThemeIcon();
  });

  $("#logout-btn").addEventListener("click", async () => {
    await fetch("/logout", { method: "POST" });
    location.href = "/login";
  });

  buildCreateModal();
  $("#create-open").addEventListener("click", () => openCreateModal());

  // Fill the connections card.
  getOverview().then((overview) => {
    const connected = Object.values(overview.accounts).filter((a) => a.length).length;
    const total = Object.keys(PLATFORMS).length;
    $("#plan-sub").textContent = `${connected} of ${total} platforms connected`;
    $("#plan-fill").style.width = `${(connected / total) * 100}%`;
  }).catch(() => {});
}

/* ---------- Create Content modal (shared by all pages) ---------- */

function buildCreateModal() {
  const wrap = document.createElement("div");
  wrap.className = "modal-backdrop";
  wrap.id = "create-modal";
  wrap.hidden = true;
  wrap.innerHTML = `
    <form class="modal" id="create-form">
      <div class="modal-head">
        <h2>Create a UGC video</h2>
        <button type="button" class="icon-btn" id="create-close">${icons.x}</button>
      </div>
      <label class="field-label" for="product-url">Product URL</label>
      <input id="product-url" type="url" placeholder="https://yourstore.com/products/awesome-thing" required />
      <div class="modal-grid">
        <div>
          <label class="field-label" for="tone">Tone</label>
          <select id="tone">
            <option value="casual">Casual friend</option>
            <option value="excited">Hyped &amp; excited</option>
            <option value="professional">Pro reviewer</option>
            <option value="storytelling">Storytelling</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="style-select">Style</label>
          <select id="style-select">
            ${STYLES.map((s) => `<option value="${s.key}">${s.name}</option>`).join("")}
          </select>
        </div>
      </div>
      <label class="field-label">Post to</label>
      <div class="platform-picks" id="platform-picks"><span class="empty small">Loading accounts…</span></div>
      <label class="toggle">
        <input type="checkbox" id="auto-post" checked />
        <span>Auto-post to all selected socials when the video is ready</span>
      </label>
      <div class="gen-hint" id="gen-hint"></div>
      <button type="submit" class="btn btn-primary btn-block btn-ico" id="generate-btn">
        ${icons.sparkle} <span>Generate &amp; post</span>
      </button>
    </form>`;
  document.body.appendChild(wrap);

  $("#create-close").addEventListener("click", closeCreateModal);
  wrap.addEventListener("click", (e) => { if (e.target === wrap) closeCreateModal(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !wrap.hidden) closeCreateModal();
  });

  $("#create-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("#generate-btn");
    btn.disabled = true;
    try {
      await api("/ugc/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          productUrl: $("#product-url").value.trim(),
          tone: $("#tone").value,
          style: $("#style-select").value,
          platforms: $$("#platform-picks input:checked").map((i) => i.value),
          autoPost: $("#auto-post").checked,
        }),
      });
      $("#product-url").value = "";
      closeCreateModal();
      toast("On it! Scraping the product page…");
      document.dispatchEvent(new CustomEvent("ugc:job-created"));
    } catch (err) {
      toast(String(err.message || err), "error");
    } finally {
      btn.disabled = false;
    }
  });
}

let modalPopulated = false;
export function openCreateModal(styleKey) {
  const modal = $("#create-modal");
  if (styleKey) $("#style-select").value = styleKey;
  modal.hidden = false;
  setTimeout(() => $("#product-url").focus(), 50);

  if (!modalPopulated) {
    modalPopulated = true;
    getOverview().then((overview) => {
      const picks = $("#platform-picks");
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
      const gen = overview.generator;
      $("#gen-hint").innerHTML = gen.heygenConfigured
        ? `Generator: <b>HeyGen avatar</b> — a talking-creator video rendered from the script.`
        : `Generator: <b>built-in renderer</b> — product images + captions${gen.openaiConfigured ? " with an AI voiceover" : ""}.`;
    }).catch(() => {});
  }
}

export function closeCreateModal() {
  $("#create-modal").hidden = true;
}

/* ---------- Job cards (dashboard + content pages) ---------- */

export function jobCard(job) {
  const p = job.product;
  const img = p?.images?.[0];
  const [label, cls] = STATE_LABELS[job.status] || [job.status, ""];

  const styledPhoto = PHOTOS[job.settings?.style] || PHOTOS.generic;
  const media = job.videoUrl
    ? `<video src="${esc(job.videoUrl)}" controls playsinline preload="metadata"></video>`
    : img
      ? `<img src="${esc(img)}" alt="" loading="lazy">`
      : `<div class="placeholder">${icons.film}${photoImg(styledPhoto)}</div>`;

  const postChips = job.posts.slice(0, 4).map((post) => {
    const pc = post.status === "done" ? "ok" : post.status === "failed" ? "err" : "";
    const text = `${PLATFORMS[post.platform]?.[0] || post.platform}`;
    return post.url
      ? `<a class="mini-badge ${pc}" href="${esc(post.url)}" target="_blank" rel="noopener" title="${esc(post.error || "View post")}">${text} ${icons.external}</a>`
      : `<span class="mini-badge ${pc}" title="${esc(post.error || post.status)}">${text}</span>`;
  }).join("");

  const failedPosts = job.posts.filter((x) => x.status === "failed").length;
  const actions = [];
  if (job.status === "failed") {
    actions.push(`<button class="mini-btn" data-act="retry" data-id="${job.id}">${icons.retry} Retry</button>`);
  }
  if (job.videoUrl && ["ready", "posted"].includes(job.status)) {
    actions.push(`<button class="mini-btn" data-act="post" data-id="${job.id}">${icons.send} Post</button>`);
    if (failedPosts) {
      actions.push(`<button class="mini-btn" data-act="post-failed" data-id="${job.id}">${icons.retry} Failed (${failedPosts})</button>`);
    }
    actions.push(`<a class="mini-btn" href="${esc(job.videoUrl)}" download title="Download video">${icons.download}</a>`);
    actions.push(`<button class="mini-btn" data-act="regen" data-id="${job.id}" title="Regenerate from scratch">${icons.sparkle} Redo</button>`);
  }
  actions.push(`<button class="mini-btn danger" data-act="delete" data-id="${job.id}" title="Delete">${icons.trash}</button>`);

  const firstDone = job.posts.find((x) => x.status === "done");
  const titleIcon = PLATFORMS[firstDone?.platform]?.[1] || icons.film;

  return `<div class="job">
    <div class="job-thumb">
      <span class="job-state ${cls}">${label}</span>
      ${media}
    </div>
    <div class="job-title" title="${esc(p?.name || job.productUrl)}">
      <span class="pico">${titleIcon}</span>
      <span class="t">${esc(p?.name || job.productUrl)}</span>
    </div>
    <div class="job-date">${fmtDay(job.createdAt)}${job.script?.hook ? ` · “${esc(job.script.hook.slice(0, 40))}${job.script.hook.length > 40 ? "…" : ""}”` : ""}</div>
    ${job.error ? `<div class="job-error">${esc(job.error)}</div>` : ""}
    ${postChips ? `<div class="job-posts">${postChips}</div>` : ""}
    <div class="job-actions">${actions.join("")}</div>
  </div>`;
}

// Wires retry/post/regenerate/delete clicks inside `host`; calls onChange()
// after any action so the page can refresh its data.
export function bindJobActions(host, onChange) {
  host.addEventListener("click", async (e) => {
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
      await onChange();
    } catch (err) {
      toast(String(err.message || err), "error");
    } finally {
      btn.disabled = false;
    }
  });
}
