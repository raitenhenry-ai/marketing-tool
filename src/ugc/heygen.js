import fs from "node:fs";
import config from "../config.js";

// HeyGen avatar provider: hands the script to HeyGen, polls until the
// avatar video renders, then downloads the mp4 into our data dir.

const API = "https://api.heygen.com";
const POLL_MS = 10 * 1000;
const MAX_WAIT_MS = 15 * 60 * 1000;

export function heygenConfigured() {
  return Boolean(config.ugc.heygenApiKey);
}

async function call(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "X-Api-Key": config.ugc.heygenApiKey,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const detail = data.error?.message || data.message || JSON.stringify(data).slice(0, 300);
    throw new Error(`HeyGen ${path} failed (${res.status}): ${detail}`);
  }
  return data;
}

// Kicks off the render and resolves with HeyGen's video id.
export async function startAvatarVideo({ text, settings = {} }) {
  const body = {
    video_inputs: [
      {
        character: {
          type: "avatar",
          avatar_id: settings.avatarId || config.ugc.heygenAvatarId,
          avatar_style: "normal",
        },
        voice: {
          type: "text",
          input_text: text.slice(0, 1500),
          voice_id: settings.voiceId || config.ugc.heygenVoiceId,
          speed: 1.05,
        },
        background: { type: "color", value: "#0b0d12" },
      },
    ],
    dimension: { width: 720, height: 1280 },
  };
  const data = await call("/v2/video/generate", { method: "POST", body: JSON.stringify(body) });
  const videoId = data.data?.video_id;
  if (!videoId) throw new Error(`HeyGen returned no video_id: ${JSON.stringify(data).slice(0, 300)}`);
  return videoId;
}

// Polls until the video completes, then streams it to outputPath.
export async function waitAndDownload(videoId, outputPath) {
  const started = Date.now();
  for (;;) {
    const data = await call(`/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`);
    const status = data.data?.status;
    if (status === "completed") {
      const url = data.data?.video_url;
      if (!url) throw new Error("HeyGen finished but returned no video_url");
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Downloading the HeyGen video failed (${res.status})`);
      fs.writeFileSync(outputPath, Buffer.from(await res.arrayBuffer()));
      return outputPath;
    }
    if (status === "failed") {
      throw new Error(`HeyGen render failed: ${data.data?.error?.message || "unknown error"}`);
    }
    if (Date.now() - started > MAX_WAIT_MS) {
      throw new Error("HeyGen render timed out after 15 minutes");
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}
