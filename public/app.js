const $ = (sel, el = document) => el.querySelector(sel);

const PLATFORM_LABELS = { youtube: "YouTube", instagram: "Instagram", tiktok: "TikTok" };

function showBannerFromQuery() {
  const params = new URLSearchParams(location.search);
  const banner = $("#banner");
  if (params.get("connected")) {
    banner.textContent = `${PLATFORM_LABELS[params.get("connected")] || "Account"} connected!`;
    banner.classList.remove("hidden", "error");
  } else if (params.get("connect_error")) {
    banner.textContent = `Connection failed: ${params.get("connect_error")}`;
    banner.classList.remove("hidden");
    banner.classList.add("error");
  }
  if ([...params.keys()].length) history.replaceState(null, "", "/");
}

async function loadAccounts() {
  const res = await fetch("/api/accounts");
  const data = await res.json();

  $("#clip-len").textContent = `${Math.round(data.settings.clipDurationSeconds / 60)}-minute`;
  $("#interval").textContent = `${data.settings.uploadIntervalHours} hours`;
  $("#subs-note").textContent = data.settings.subtitlesEnabled
    ? "Auto-subtitles: on."
    : "Auto-subtitles: off (set OPENAI_API_KEY to enable).";

  const max = data.settings.maxAccountsPerPlatform;
  for (const [name, info] of Object.entries(data.platforms)) {
    const card = document.querySelector(`.card[data-platform="${name}"]`);
    const status = $(".card-status", card);
    const actions = $(".card-actions", card);
    card.classList.toggle("connected", info.accounts.length > 0);

    if (!info.configured) {
      status.textContent = "API credentials missing (see .env.example)";
      actions.innerHTML = "";
      continue;
    }

    status.innerHTML = info.accounts.length
      ? info.accounts.map((a) =>
          `<span class="account-row">${a.displayName || "account"}
             <button class="unlink" title="Disconnect" data-disconnect-id="${a.id}">&times;</button>
           </span>`
        ).join("")
      : "Not connected";

    actions.innerHTML = info.accounts.length < max
      ? `<a class="btn" href="/auth/${name}">Connect account (${info.accounts.length}/${max})</a>`
      : `<span class="video-meta">Account limit reached (${max}/${max})</span>`;
  }
}

document.addEventListener("click", async (e) => {
  const accountId = e.target.dataset?.disconnectId;
  if (accountId) {
    await fetch(`/auth/accounts/${accountId}/disconnect`, { method: "POST" });
    loadAccounts();
    return;
  }
  const retryId = e.target.dataset?.retry;
  if (retryId) {
    await fetch(`/api/videos/${retryId}/reprocess`, { method: "POST" });
    loadVideos();
    return;
  }
  const delId = e.target.dataset?.del;
  if (delId) {
    if (!confirm("Delete this video and all its clips? Already-published posts stay up.")) return;
    await fetch(`/api/videos/${delId}`, { method: "DELETE" });
    loadVideos();
  }
});

$("#upload-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const file = $("#file").files[0];
  if (!file) return;

  const form = new FormData();
  form.append("title", $("#title").value);
  form.append("cuts", $("#cuts").value);
  form.append("video", file);

  const btn = $("#upload-btn");
  const progress = $("#upload-progress");
  btn.disabled = true;
  progress.classList.remove("hidden");

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/videos");
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) progress.value = (ev.loaded / ev.total) * 100;
  };
  xhr.onload = xhr.onerror = () => {
    btn.disabled = false;
    progress.classList.add("hidden");
    progress.value = 0;
    if (xhr.status >= 200 && xhr.status < 300) {
      $("#upload-form").reset();
    } else {
      alert(`Upload failed: ${xhr.responseText || xhr.status}`);
    }
    loadVideos();
  };
  xhr.send(form);
});

function fmtTime(ms) {
  return new Date(ms).toLocaleString([], {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function chip(upload) {
  const label = PLATFORM_LABELS[upload.platform] || upload.platform;
  const account = upload.account_name ? ` (${upload.account_name})` : "";
  const title = upload.error ? ` title="${upload.error.replaceAll('"', "&quot;")}"` : "";
  return `<span class="chip ${upload.status}"${title}>${label}${account}: ${upload.status}</span>`;
}

async function loadVideos() {
  const res = await fetch("/api/videos");
  const videos = await res.json();
  const el = $("#videos");

  if (!videos.length) {
    el.innerHTML = `<p class="empty">No videos yet - upload one above.</p>`;
    return;
  }

  el.innerHTML = videos.map((v) => {
    const clips = v.clips.map((c) => {
      const due = c.scheduledAt <= Date.now();
      const when = due ? "publishing window open" : `publishes ${fmtTime(c.scheduledAt)}`;
      const chips = c.uploads.length
        ? `<span class="chips">${c.uploads.map(chip).join("")}</span>`
        : `<span class="clip-when">${when}</span>`;
      const genTitle = c.genTitle
        ? `<span class="gen-title">&ldquo;${c.genTitle}&rdquo;</span>`
        : "";
      return `<div class="clip">
        <span><a href="${c.url}" target="_blank">Part ${c.part}/${c.totalParts}</a>
          <span class="clip-when">(${Math.round(c.durationSeconds)}s)</span> ${genTitle}</span>
        ${chips}
      </div>`;
    }).join("");

    const assigned = (v.accounts || [])
      .map((a) => `${PLATFORM_LABELS[a.platform] || a.platform}: ${a.account_name}`)
      .join(" &middot; ");
    const statusLine =
      v.status === "processing" ? "Splitting into clips&hellip;"
      : v.status === "failed" ? `<span class="video-error">Processing failed: ${v.error || "unknown error"}</span>`
      : `${v.clips.length} clip(s)${assigned ? ` &rarr; ${assigned}` : ""}`;

    const actions =
      (v.status === "failed" ? `<button class="secondary" data-retry="${v.id}">Retry</button> ` : "") +
      `<button class="secondary danger" data-del="${v.id}">Delete</button>`;

    return `<div class="video-item">
      <div class="video-head">
        <span class="video-title">${v.title}</span>
        <span class="video-meta">${statusLine}</span>
        <span class="video-actions">${actions}</span>
      </div>
      <div class="clips">${clips}</div>
    </div>`;
  }).join("");
}

showBannerFromQuery();
loadAccounts();
loadVideos();
setInterval(loadVideos, 8000);
setInterval(loadAccounts, 30000);
