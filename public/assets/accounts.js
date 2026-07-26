import {
  $, api, initShell, icons, esc, toast, confirmDialog, fmtDateTime, PLATFORMS,
} from "/assets/common.js";

initShell({ title: "Accounts" });

const DESCRIPTIONS = {
  youtube: "Clips publish as Shorts via the YouTube Data API.",
  instagram: "Clips publish as Reels. Requires a Business or Creator account.",
  tiktok: "Clips publish via the Content Posting API.",
  facebook: "Clips publish as Reels on your Facebook Pages — connecting adds every Page you manage.",
  x: "Clips publish as video posts via the X API.",
};

// Surface OAuth results passed back through the URL after a connect redirect.
const params = new URLSearchParams(location.search);
if (params.get("connected")) {
  toast(`${PLATFORMS[params.get("connected")] || "Account"} connected`);
  history.replaceState(null, "", "/accounts.html");
} else if (params.get("connect_error")) {
  toast(`Connection failed: ${params.get("connect_error")}`, "error");
  history.replaceState(null, "", "/accounts.html");
}

document.addEventListener("change", async (e) => {
  const select = e.target.closest("[data-gap-account]");
  if (!select) return;
  try {
    await api(`/api/accounts/${select.dataset.gapAccount}`, {
      method: "PATCH",
      body: JSON.stringify({ minGapHours: Number(select.value) }),
    });
    toast(Number(select.value)
      ? `Saved — this account now posts its queue ${select.options[select.selectedIndex].text.toLowerCase()}`
      : "Saved — this account follows the default schedule");
  } catch (err) {
    toast(err.message, "error");
    load();
  }
});

document.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-disconnect]");
  if (!btn) return;
  const ok = await confirmDialog({
    title: `Disconnect ${btn.dataset.name}?`,
    message: "Videos assigned to this account will be reassigned to another connected account the next time they publish. Nothing already posted is affected.",
    confirmText: "Disconnect",
  });
  if (!ok) return;
  try {
    await fetch(`/auth/accounts/${btn.dataset.disconnect}/disconnect`, { method: "POST" });
    toast("Account disconnected");
    load();
  } catch (err) { toast(String(err.message || err), "error"); }
});

const GAP_OPTIONS = [
  [0, "Default schedule"],
  [0.25, "every 15 min"], [0.5, "every 30 min"], [0.75, "every 45 min"],
  [1, "every hour"], [1.5, "every 1.5 hours"], [2, "every 2 hours"],
  [3, "every 3 hours"], [4, "every 4 hours"], [6, "every 6 hours"],
  [8, "every 8 hours"], [12, "every 12 hours"], [24, "every day"],
  [48, "every 2 days"], [72, "every 3 days"], [168, "every week"],
];

function gapSelect(a) {
  const current = Number(a.minGapHours || 0);
  const options = GAP_OPTIONS.some(([v]) => v === current)
    ? GAP_OPTIONS
    : [...GAP_OPTIONS, [current, `every ${current} hours`]].sort((x, y) => x[0] - y[0]);
  return `<label class="gap-control" title="This account's own posting rhythm. 'Default schedule' follows the global part timeline; any other value makes the account post its next pending clip at that pace.">
    <span>posts</span>
    <select class="input input-sm" data-gap-account="${a.id}">
      ${options.map(([v, label]) =>
        `<option value="${v}" ${v === current ? "selected" : ""}>${label}</option>`).join("")}
    </select>
  </label>`;
}

function platformCard(key, info, max) {
  const n = info.accounts.length;

  const accountRows = info.accounts.map((a) => `
    <div class="account-row">
      <div class="avatar">${esc((a.displayName || "?").slice(0, 1).toUpperCase())}</div>
      <div>
        <div class="account-name">${esc(a.displayName || "account")}</div>
        <div class="account-meta">connected ${fmtDateTime(a.connectedAt)} · ${a.videosAssigned} video(s) assigned</div>
      </div>
      <div class="spacer"></div>
      ${gapSelect(a)}
      <button class="btn btn-sm btn-ghost" data-disconnect="${a.id}" data-name="${esc(a.displayName || "this account")}">Disconnect</button>
    </div>`).join("");

  const action = !info.configured
    ? `<div class="callout">${icons.alert}<span>
         API credentials for ${PLATFORMS[key]} are not set. Add them to <code>.env</code>
         (see <code>.env.example</code>) and restart, then connect accounts here.
       </span></div>`
    : n >= max
      ? `<span class="muted" style="font-size:13px">Account limit reached (${n}/${max})</span>`
      : `<a class="btn btn-secondary" href="/auth/${key}">${icons.plus} Connect account (${n}/${max})</a>`;

  return `<div class="card platform-card">
    <div class="platform-head">
      <div class="platform-logo ${key}">${icons[key]}</div>
      <div>
        <div class="platform-name">${PLATFORMS[key]}</div>
        <div class="platform-sub">${DESCRIPTIONS[key]}</div>
      </div>
      <div class="spacer"></div>
      ${info.configured ? `<span class="badge ${n ? "done" : ""}">${n ? `${n} connected` : "not connected"}</span>` : ""}
    </div>
    ${accountRows}
    <div class="${n ? "mt-8" : ""}">${action}</div>
  </div>`;
}

async function load() {
  try {
    const data = await api("/api/accounts");
    const max = data.settings.maxAccountsPerPlatform;
    $("#platforms-host").innerHTML = Object.keys(data.platforms)
      .map((key) => platformCard(key, data.platforms[key], max)).join("");
  } catch { /* auth redirect */ }
}

load();
