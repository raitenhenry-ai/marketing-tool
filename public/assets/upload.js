import {
  $, api, initShell, icons, esc, toast, fmtSize, fmtDateTime, fmtDuration,
} from "./common.js";

initShell({ title: "Upload" });

let settings = null;
let file = null;
let videoDuration = null; // probed client-side when possible

/* ---------- Cut-time parsing (mirrors the server's src/cuts.js) ---------- */

function parseTime(str) {
  const s = str.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) {
    throw new Error(`"${s}" is not a valid time (use SS, M:SS or H:MM:SS)`);
  }
  const parts = s.split(":").map(Number);
  let seconds = 0;
  for (const p of parts) {
    if (p >= 60 && parts.length > 1 && p !== parts[0]) {
      throw new Error(`"${s}" has minutes/seconds over 59`);
    }
    seconds = seconds * 60 + p;
  }
  return seconds;
}

function parseCuts(text) {
  const entries = String(text || "").split(/[\n,;]+/).map((e) => e.trim()).filter(Boolean);
  if (!entries.length) return null;
  const isRange = (e) => /.-/.test(e) || e.endsWith("-");
  const rangeCount = entries.filter(isRange).length;
  if (rangeCount && rangeCount !== entries.length) {
    throw new Error("Don't mix cut points and ranges");
  }
  if (rangeCount) {
    return entries.map((entry) => {
      const m = entry.match(/^(.+?)\s*-\s*(.*)$/);
      if (!m) throw new Error(`"${entry}" is not a valid range`);
      const start = parseTime(m[1]);
      const end = m[2] ? parseTime(m[2]) : null;
      if (end !== null && end <= start) throw new Error(`Range "${entry}" ends before it starts`);
      return { start, end };
    });
  }
  const points = [...new Set(entries.map(parseTime))].sort((a, b) => a - b).filter((t) => t > 0);
  if (!points.length) return null;
  const segments = [];
  let prev = 0;
  for (const t of points) { segments.push({ start: prev, end: t }); prev = t; }
  segments.push({ start: prev, end: null });
  return segments;
}

function fmtClipLen(seconds) {
  return seconds % 60 === 0 ? `${seconds / 60}-minute` : `${seconds}-second`;
}

function fmtClock(s) {
  const m = Math.floor(s / 60), sec = Math.round(s % 60);
  const h = Math.floor(m / 60);
  if (h) return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function computeSegments() {
  const text = $("#cuts").value;
  let segments = null;
  try {
    segments = parseCuts(text);
    $("#cuts").style.borderColor = "";
  } catch (err) {
    $("#cuts-preview").innerHTML = `<span style="color:var(--danger)">${esc(err.message)}</span>`;
    $("#cuts").style.borderColor = "var(--danger)";
    return null;
  }

  const dur = videoDuration;
  if (!segments) {
    const clipLen = settings?.clipDurationSeconds || 120;
    if (!dur) {
      $("#cuts-preview").textContent =
        `Auto-split into equal ${fmtClipLen(clipLen)} parts.`;
      return "auto";
    }
    segments = [];
    for (let t = 0; t < dur; t += clipLen) {
      segments.push({ start: t, end: Math.min(t + clipLen, dur) });
    }
  } else if (dur) {
    segments = segments
      .map(({ start, end }) => ({ start, end: Math.min(end ?? dur, dur) }))
      .filter(({ start, end }) => start < dur && end - start >= 0.5);
  }

  const parts = segments.map((s, i) =>
    `Part ${i + 1}: ${fmtClock(s.start)}–${s.end == null ? "end" : fmtClock(s.end)}`);
  $("#cuts-preview").innerHTML =
    `<strong>${segments.length} clip(s)</strong> — ${esc(parts.slice(0, 6).join("  ·  "))}${parts.length > 6 ? ` · +${parts.length - 6} more` : ""}`;
  return segments;
}

function publishMode() {
  return document.querySelector('input[name="pubmode"]:checked')?.value || "manual";
}

function renderSchedulePreview() {
  const segments = computeSegments();
  const host = $("#schedule-preview");
  if (publishMode() === "manual") {
    host.innerHTML = `Manual mode: nothing gets posted. When processing finishes, grab the clips
      from the video page — one by one or as an organized ZIP with captions included.`;
    return;
  }
  if (!file) {
    host.textContent = "Pick a file to preview when each part will publish.";
    return;
  }
  if (!segments || segments === "auto") {
    host.textContent = videoDuration == null
      ? "Reading video duration…"
      : "Fix the cut times above to preview the schedule.";
    return;
  }
  const interval = (settings?.uploadIntervalHours || 3) * 3600 * 1000;
  const now = Date.now();
  host.innerHTML = segments.slice(0, 8).map((s, i) => `
    <div class="tl-item" style="padding:8px 12px">
      <span class="tl-time">${i === 0 ? "right away" : `+${i * (settings?.uploadIntervalHours || 3)}h`}</span>
      <div class="tl-body">
        <div class="tl-title">Part ${i + 1} <span class="muted">(${fmtDuration((s.end ?? videoDuration) - s.start)})</span></div>
        <div class="tl-sub">≈ ${fmtDateTime(now + i * interval)} (after processing finishes)</div>
      </div>
    </div>`).join("") +
    (segments.length > 8 ? `<div class="muted mt-8" style="font-size:12px">+ ${segments.length - 8} more parts, every ${settings?.uploadIntervalHours || 3} hours</div>` : "");
}

/* ---------- File selection ---------- */

const dropzone = $("#dropzone");
const fileInput = $("#file");

function setFile(f) {
  if (!f) return;
  if (!(f.type || "").startsWith("video/")) {
    toast("That doesn't look like a video file", "error");
    return;
  }
  file = f;
  videoDuration = null;
  dropzone.classList.add("has-file");
  $("#dz-idle").hidden = true;
  const el = $("#dz-file");
  el.hidden = false;
  el.innerHTML = `<span class="file-pill">${icons.film} ${esc(f.name)} <span class="size">${fmtSize(f.size)}</span></span>
    <div class="dz-sub mt-8">Click to choose a different file</div>`;
  if (!$("#title").value) {
    $("#title").value = f.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
  }
  $("#upload-btn").disabled = false;

  // Probe duration in-browser so the previews are exact.
  const url = URL.createObjectURL(f);
  const probe = document.createElement("video");
  probe.preload = "metadata";
  probe.onloadedmetadata = () => {
    videoDuration = probe.duration;
    URL.revokeObjectURL(url);
    renderSchedulePreview();
  };
  probe.onerror = () => { URL.revokeObjectURL(url); renderSchedulePreview(); };
  probe.src = url;
  renderSchedulePreview();
}

dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
fileInput.addEventListener("change", () => setFile(fileInput.files[0]));

["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); }));
dropzone.addEventListener("drop", (e) => setFile(e.dataTransfer.files[0]));

$("#cuts").addEventListener("input", renderSchedulePreview);
document.querySelectorAll('input[name="pubmode"]')
  .forEach((el) => el.addEventListener("change", renderSchedulePreview));

/* ---------- Submit ---------- */

$("#upload-btn").addEventListener("click", () => {
  if (!file) return;
  const segments = computeSegments();
  if (segments === null) {
    toast("Fix the cut times before uploading", "error");
    return;
  }

  const form = new FormData();
  form.append("title", $("#title").value);
  form.append("cuts", $("#cuts").value);
  form.append("publishMode", publishMode());
  form.append("video", file);

  const btn = $("#upload-btn");
  btn.disabled = true;
  $("#progress-wrap").hidden = false;
  $("#upload-status").textContent = "Uploading…";

  const xhr = new XMLHttpRequest();
  xhr.open("POST", "/api/videos");
  xhr.upload.onprogress = (ev) => {
    if (ev.lengthComputable) {
      const pct = Math.round((ev.loaded / ev.total) * 100);
      $("#progress-fill").style.width = `${pct}%`;
      $("#upload-status").textContent = `Uploading… ${pct}%`;
    }
  };
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      const { id } = JSON.parse(xhr.responseText);
      toast("Uploaded — splitting into clips now");
      location.href = `video.html?id=${id}`;
    } else {
      let msg = `Upload failed (${xhr.status})`;
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
      toast(msg, "error");
      btn.disabled = false;
      $("#progress-wrap").hidden = true;
      $("#upload-status").textContent = "";
    }
  };
  xhr.onerror = () => {
    toast("Upload failed — network error", "error");
    btn.disabled = false;
    $("#progress-wrap").hidden = true;
    $("#upload-status").textContent = "";
  };
  xhr.send(form);
});

/* ---------- Pipeline info panel ---------- */

async function loadSettings() {
  try {
    const s = await api("/api/settings");
    settings = {
      clipDurationSeconds: s.branding.clipDurationSeconds,
      uploadIntervalHours: s.branding.uploadIntervalHours,
    };
    const note = $("#interval-note");
    if (note) note.textContent = `${s.branding.uploadIntervalHours} hours`;
    const steps = [
      { icon: "scissors", text: `Split into <strong>${fmtClipLen(s.branding.clipDurationSeconds)}</strong> parts (or your custom cuts), rendered ${s.branding.verticalFormat ? "vertical 1080×1920" : "in the original aspect"} with the <strong>PART n/total</strong> badge and <strong>${esc(s.branding.siteDomain)}</strong> burned in.` },
      { icon: "captions", text: s.ai.subtitlesEnabled
          ? "Word-by-word highlighted <strong>subtitles</strong> from the audio."
          : `Subtitles are <span class="on-off off">off</span> — set <code>OPENAI_API_KEY</code> to enable.` },
      { icon: "sparkle", text: s.ai.metadataEnabled
          ? "A unique <strong>AI title, description and hashtags</strong> per clip."
          : `AI titles/hashtags are <span class="on-off off">off</span> — set <code>OPENAI_API_KEY</code> to enable.` },
      { icon: "send", text: `Part 1 publishes when processing finishes; each next part <strong>${s.branding.uploadIntervalHours} hours</strong> later, to every connected account.` },
    ];
    $("#pipeline-info").innerHTML = steps.map((st) => `
      <div class="flex mb-8" style="align-items:flex-start">
        <span style="color:var(--accent-hover);flex-shrink:0;width:17px;margin-top:2px">${icons[st.icon]}</span>
        <span style="font-size:13px;color:var(--text-2)">${st.text}</span>
      </div>`).join("");
    renderSchedulePreview();
  } catch { /* auth redirect handles it */ }
}

loadSettings();
