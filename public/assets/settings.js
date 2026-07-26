import { $, api, initShell, icons, esc, toast, fmtDuration, PLATFORMS } from "/assets/common.js";

initShell({ title: "Settings" });

document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-copy]");
  if (!btn) return;
  navigator.clipboard.writeText(btn.dataset.copy)
    .then(() => toast("Copied to clipboard"))
    .catch(() => toast("Couldn't copy — select it manually", "error"));
});

const onOff = (v, onText = "On", offText = "Off") =>
  `<span class="on-off ${v ? "on" : "off"}">${v ? onText : offText}</span>`;

function kvSection(title, rows, hint = "") {
  return `<div class="card mb-16">
    <div class="card-title">${title}${hint ? ` <span class="hint">${hint}</span>` : ""}</div>
    <div class="kv">
      ${rows.map(([k, v]) => `<div class="k">${k}</div><div class="v">${v}</div>`).join("")}
    </div>
  </div>`;
}

function copyable(text) {
  return `<code>${esc(text)}</code>
    <button class="icon-btn copy-btn" title="Copy" data-copy="${esc(text)}">${icons.copy}</button>`;
}

async function load() {
  let s;
  try {
    s = await api("/api/settings");
  } catch { return; }

  $("#settings-host").innerHTML = [
    kvSection("Clips & branding", [
      ["Site domain overlay", `<code>${esc(s.branding.siteDomain)}</code> <span class="muted">burned into every clip + captions</span>`],
      ["Clip length", `${s.branding.clipDurationSeconds % 60 === 0
        ? `${s.branding.clipDurationSeconds / 60} minutes`
        : `${s.branding.clipDurationSeconds} seconds`} <span class="muted">(auto-split; custom cuts override per upload)</span>`],
      ["Publish interval", `every ${s.branding.uploadIntervalHours} hours per video`],
      ["Format", s.branding.verticalFormat
        ? `Vertical 1080×1920 <span class="muted">with blurred background fill</span>`
        : "Original aspect ratio"],
    ], "SITE_DOMAIN · CLIP_DURATION_SECONDS · UPLOAD_INTERVAL_HOURS · VERTICAL_FORMAT"),

    kvSection("Encoding quality", [
      ["Quality (CRF)", `${s.quality.videoCrf} <span class="muted">lower = better/bigger; 18 ≈ near-lossless</span>`],
      ["Encoder preset", `<code>${esc(s.quality.videoPreset)}</code> <span class="muted">slower presets = more quality per byte</span>`],
      ["Audio loudness normalization", onOff(s.quality.normalizeAudio, "On · −14 LUFS target")],
    ], "VIDEO_CRF · VIDEO_PRESET · NORMALIZE_AUDIO"),

    kvSection("AI features", [
      ["OpenAI API key", onOff(s.ai.openaiKeySet, "Configured", "Not set — subtitles & AI titles disabled")],
      ["Auto-subtitles", onOff(s.ai.subtitlesEnabled)],
      ["AI titles / hashtags", onOff(s.ai.metadataEnabled)],
      ["Metadata model", `<code>${esc(s.ai.chatModel)}</code>`],
    ], "OPENAI_API_KEY · SUBTITLES · GENERATE_METADATA · OPENAI_CHAT_MODEL"),

    kvSection("Accounts", [
      ["Max accounts per platform", String(s.accounts.maxPerPlatform)],
      ["Platform API credentials", ["youtube", "instagram", "tiktok"].map((p) =>
        `<span class="chip"><span class="pdot ${p}"></span>${PLATFORMS[p]} ${onOff(s.server.credentialsConfigured[p], "set", "missing")}</span>`).join(" ")],
    ], "MAX_ACCOUNTS_PER_PLATFORM"),

    kvSection("OAuth redirect URIs", [
      ["YouTube", copyable(s.server.redirectUris.youtube)],
      ["Instagram", copyable(s.server.redirectUris.instagram)],
      ["TikTok", copyable(s.server.redirectUris.tiktok)],
    ], "register these in each platform's developer console"),

    kvSection("Disk cleanup", [
      ["Delete originals after", s.cleanup.deleteOriginalsAfterDays > 0
        ? `${s.cleanup.deleteOriginalsAfterDays} days <span class="muted">clips are kept; originals are only needed for re-processing</span>`
        : onOff(false, "", "Never")],
      ["Prune published videos after", s.cleanup.pruneVideosAfterDays > 0
        ? `${s.cleanup.pruneVideosAfterDays} days`
        : onOff(false, "", "Never — kept forever")],
    ], "DELETE_ORIGINALS_AFTER_DAYS · PRUNE_VIDEOS_AFTER_DAYS"),

    kvSection("Server", [
      ["Base URL", copyable(s.server.baseUrl)],
      ["Dashboard login", onOff(s.server.authEnabled, "Password protected", "OPEN — set ADMIN_PASSWORD before going public")],
      ["Uptime", fmtDuration(s.server.uptimeSeconds)],
      ["Encode queue", s.server.queueDepth ? `${s.server.queueDepth} video(s) waiting` : "idle"],
      ["Node.js", `<code>${esc(s.server.nodeVersion)}</code>`],
    ], "BASE_URL · ADMIN_PASSWORD"),
  ].join("");
}

load();
setInterval(load, 15000);
