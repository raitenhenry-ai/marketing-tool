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
