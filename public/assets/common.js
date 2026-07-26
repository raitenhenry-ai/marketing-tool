/* Shared shell, API helpers, and UI primitives for every page. */

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export const PLATFORMS = {
  youtube: "YouTube",
  instagram: "Instagram",
  tiktok: "TikTok",
};

/* ---------- Icons (inline SVG, stroke-based) ---------- */

const stroke = (paths, extra = "") =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${paths}</svg>`;

export const icons = {
  dashboard: stroke('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>'),
  upload: stroke('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>'),
  videos: stroke('<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m10 9 5 3-5 3z"/>'),
  schedule: stroke('<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/><path d="M12 14v3l2 1"/>'),
  accounts: stroke('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
  settings: stroke('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>'),
  logout: stroke('<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>'),
  check: stroke('<polyline points="20 6 9 17 4 12"/>'),
  alert: stroke('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'),
  clock: stroke('<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>'),
  film: stroke('<rect x="2" y="2" width="20" height="20" rx="2.5"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>'),
  send: stroke('<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>'),
  copy: stroke('<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  trash: stroke('<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>'),
  retry: stroke('<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>'),
  external: stroke('<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>'),
  plus: stroke('<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>'),
  scissors: stroke('<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/>'),
  captions: stroke('<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M6 13h4M6 16h8M14 13h4"/>'),
  sparkle: stroke('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/>'),
  youtube: stroke('<path d="M22.5 6.4a3 3 0 0 0-2.1-2.1C18.5 3.8 12 3.8 12 3.8s-6.5 0-8.4.5A3 3 0 0 0 1.5 6.4 31 31 0 0 0 1 12a31 31 0 0 0 .5 5.6 3 3 0 0 0 2.1 2.1c1.9.5 8.4.5 8.4.5s6.5 0 8.4-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 23 12a31 31 0 0 0-.5-5.6z"/><polygon points="10 15 15 12 10 9"/>'),
  instagram: stroke('<rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/>'),
  tiktok: stroke('<path d="M9 12a4 4 0 1 0 4 4V4c.7 2.3 2.7 4.6 6 5"/>'),
};

/* ---------- Formatters ---------- */

export function fmtDateTime(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export function fmtTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function fmtDay(ms) {
  const d = new Date(ms);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that - today) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

export function fmtDuration(seconds) {
  if (seconds == null) return "—";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}h ${m % 60}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function fmtSize(bytes) {
  if (!bytes) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0, n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function relTime(ms) {
  if (!ms) return "—";
  const diff = ms - Date.now();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let span;
  if (mins < 1) span = "now";
  else if (mins < 60) span = `${mins}m`;
  else if (hours < 24) span = `${hours}h`;
  else span = `${days}d`;
  if (span === "now") return diff >= 0 ? "any moment" : "just now";
  return diff > 0 ? `in ${span}` : `${span} ago`;
}

export function esc(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- API ---------- */

export async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
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

/* ---------- Toasts ---------- */

let toastHost;
export function toast(message, type = "success") {
  if (!toastHost) {
    toastHost = document.createElement("div");
    toastHost.className = "toast-host";
    document.body.appendChild(toastHost);
  }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="t-icon">${type === "error" ? icons.alert : icons.check}</span><span>${esc(message)}</span>`;
  toastHost.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 0.3s";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 320);
  }, 4200);
}

/* ---------- Confirm modal ---------- */

export function confirmDialog({ title, message, confirmText = "Delete", danger = true }) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `
      <div class="modal" role="dialog" aria-modal="true">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : ""}" data-act="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    const close = (result) => { backdrop.remove(); resolve(result); };
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop || e.target.closest('[data-act="cancel"]')) close(false);
      if (e.target.closest('[data-act="ok"]')) close(true);
    });
    document.addEventListener("keydown", function onKey(e) {
      if (e.key === "Escape") { document.removeEventListener("keydown", onKey); close(false); }
    });
    document.body.appendChild(backdrop);
    backdrop.querySelector('[data-act="ok"]').focus();
  });
}

/* ---------- Shell (sidebar + topbar) ---------- */

const NAV = [
  { section: "Content" },
  { href: "/", icon: "dashboard", label: "Dashboard" },
  { href: "/upload.html", icon: "upload", label: "Upload" },
  { href: "/videos.html", icon: "videos", label: "Videos", badge: "videos" },
  { href: "/schedule.html", icon: "schedule", label: "Schedule", badge: "scheduled" },
  { section: "Setup" },
  { href: "/accounts.html", icon: "accounts", label: "Accounts", badge: "accounts" },
  { href: "/settings.html", icon: "settings", label: "Settings" },
];

export function initShell({ title, crumb = null, actions = "" }) {
  const path = location.pathname === "/" || location.pathname === "/index.html"
    ? "/" : location.pathname;

  const sidebar = $("#sidebar");
  sidebar.className = "sidebar";
  sidebar.innerHTML = `
    <div class="brand">
      <div class="brand-mark">▶</div>
      <div>
        <div class="brand-name">ShortForm</div>
        <div class="brand-sub">content manager</div>
      </div>
    </div>
    <nav class="nav">
      ${NAV.map((item) =>
        item.section
          ? `<div class="nav-section">${item.section}</div>`
          : `<a class="nav-item ${item.href === path ? "active" : ""}" href="${item.href}">
               ${icons[item.icon]}<span>${item.label}</span>
               ${item.badge ? `<span class="nav-badge" data-nav-badge="${item.badge}" hidden></span>` : ""}
             </a>`
      ).join("")}
    </nav>
    <div class="sidebar-foot">
      <span class="health-dot" id="health-dot"><span class="dot"></span><span class="foot-label">checking…</span></span>
      <button class="icon-btn" id="logout-btn" title="Sign out">${icons.logout}</button>
    </div>`;

  const topbar = $("#topbar");
  topbar.className = "topbar";
  topbar.innerHTML = `
    <h1>${crumb ? `<a class="crumb" href="${crumb.href}">${esc(crumb.label)}</a> <span class="crumb">/</span> ` : ""}${esc(title)}</h1>
    <div class="topbar-actions">${actions}</div>`;

  $("#logout-btn").addEventListener("click", async () => {
    await fetch("/logout", { method: "POST" });
    location.href = "/login";
  });

  refreshShellStatus();
  setInterval(refreshShellStatus, 15000);
}

async function refreshShellStatus() {
  const dot = $("#health-dot");
  try {
    const [health, stats] = await Promise.all([
      fetch("/healthz").then((r) => r.json()),
      api("/api/stats").catch(() => null),
    ]);
    dot.className = "health-dot ok";
    dot.innerHTML = `<span class="dot"></span><span class="foot-label">healthy · ${fmtDuration(health.uptimeSeconds)} up</span>`;
    if (stats) {
      setNavBadge("videos", stats.totals.videos);
      setNavBadge("scheduled", stats.totals.scheduled);
      setNavBadge("accounts", stats.totals.accounts);
    }
  } catch {
    if (dot) {
      dot.className = "health-dot bad";
      dot.innerHTML = `<span class="dot"></span><span class="foot-label">unreachable</span>`;
    }
  }
}

function setNavBadge(name, value) {
  const el = document.querySelector(`[data-nav-badge="${name}"]`);
  if (!el) return;
  el.hidden = !value;
  el.textContent = value;
}

/* ---------- Shared render bits ---------- */

export function uploadChip(u) {
  const label = PLATFORMS[u.platform] || u.platform;
  const who = u.account_name || u.accountName;
  const status = u.status;
  const title = u.error ? ` title="${esc(u.error)}"` : "";
  return `<span class="badge ${status}"${title}>
    <span class="pdot ${u.platform}" style="width:6px;height:6px;border-radius:2px"></span>
    ${label}${who ? ` · ${esc(who)}` : ""} — ${status}
  </span>`;
}

export function statusBadge(status) {
  const labels = { processing: "Processing", ready: "Ready", failed: "Failed" };
  return `<span class="badge ${status}"><span class="bdot"></span>${labels[status] || status}</span>`;
}

export function skeletonRows(cols, rows = 4) {
  return Array.from({ length: rows }, () =>
    `<tr>${Array.from({ length: cols }, () =>
      `<td><div class="skeleton" style="width:${55 + Math.round(Math.random() * 35)}%">&nbsp;</div></td>`
    ).join("")}</tr>`
  ).join("");
}
