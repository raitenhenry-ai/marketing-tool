import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import config from "../config.js";
import { spokenText } from "./script.js";

// Built-in UGC renderer: no external video API needed. Builds a vertical
// 1080x1920 video from the scraped product images - blurred cover
// background, product shot fitted on top, the script burned in as big
// captions scene by scene - with an OpenAI TTS voiceover when a key is set.

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-1500)}`));
    });
  });
}

async function probeDuration(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(config.ffprobePath, [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("error", reject);
    proc.on("close", () => resolve(Number(out.trim()) || 0));
  });
}

// OpenAI text-to-speech; returns the mp3 path or null when no key is set.
async function makeVoiceover(text, outPath, voice) {
  if (!config.openaiApiKey) return null;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.ugc.ttsModel,
      voice: voice || config.ugc.ttsVoice,
      input: text.slice(0, 4000),
      response_format: "mp3",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Voiceover failed (${res.status}): ${body.slice(0, 300)}`);
  }
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
  return outPath;
}

// Word-wraps caption text for drawtext (it has no wrapping of its own).
function wrap(text, width = 24) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > width && line) {
      lines.push(line);
      line = word;
    } else {
      line = (line + " " + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

const W = 1080;
const H = 1920;

// Renders one scene: image (or gradient) + caption, exact duration, no audio.
async function renderScene({ image, text, seconds, index, workDir }) {
  const out = path.join(workDir, `scene${index}.mp4`);
  const args = ["-y"];

  if (image) {
    args.push("-loop", "1", "-t", seconds.toFixed(2), "-i", image);
  } else {
    args.push("-f", "lavfi", "-t", seconds.toFixed(2),
      "-i", `color=c=0x12141d:s=${W}x${H}:r=25`);
  }

  let filter;
  if (image) {
    // Blurred cover-fit backdrop with the product shot fitted on top - the
    // same trick the clip pipeline uses for vertical framing.
    filter =
      `[0:v]split=2[bg][fg];` +
      `[bg]scale=${W / 4}:${H / 4}:force_original_aspect_ratio=increase,` +
      `crop=${W / 4}:${H / 4},boxblur=8:2,eq=brightness=-0.12:saturation=0.8,scale=${W}:${H}[bgb];` +
      `[fg]scale=${W - 120}:${H - 700}:force_original_aspect_ratio=decrease:flags=bicubic[fgs];` +
      `[bgb][fgs]overlay=(W-w)/2:(H-h)/2-120`;
  } else {
    filter = `[0:v]null`;
  }

  if (config.fontPath && text) {
    const textFile = path.join(workDir, `scene${index}.txt`);
    fs.writeFileSync(textFile, wrap(text));
    filter +=
      `,drawtext=textfile='${escapeFilterPath(textFile)}':fontfile='${escapeFilterPath(config.fontPath)}':` +
      `fontsize=58:fontcolor=white:line_spacing=14:borderw=3:bordercolor=black@0.7:` +
      `box=1:boxcolor=black@0.35:boxborderw=26:x=(w-text_w)/2:y=h-560`;
  }

  args.push(
    "-filter_complex", `${filter},format=yuv420p[v]`,
    "-map", "[v]",
    "-r", "25",
    "-c:v", "libx264", "-preset", config.videoPreset, "-crf", String(config.videoCrf),
    "-profile:v", "high",
    out
  );
  await run(config.ffmpegPath, args);
  return out;
}

// Full local render. Returns { outputPath, durationSeconds }.
export async function renderLocalVideo({ script, images, workDir, outputPath, settings = {} }) {
  fs.mkdirSync(workDir, { recursive: true });

  const voPath = path.join(workDir, "voiceover.mp3");
  let voiceover = null;
  try {
    voiceover = await makeVoiceover(spokenText(script), voPath, settings.voice);
  } catch (err) {
    console.warn("[ugc] voiceover skipped:", err.message || err);
  }

  const texts = [script.hook, ...script.scenes, script.cta].filter(Boolean);
  const total = voiceover
    ? Math.max((await probeDuration(voiceover)) + 0.7, 8)
    : Math.max(config.ugc.videoSeconds, texts.length * 3);
  const perScene = total / texts.length;

  const sceneFiles = [];
  for (const [i, text] of texts.entries()) {
    const image = images.length ? images[i % images.length] : null;
    sceneFiles.push(await renderScene({ image, text, seconds: perScene, index: i, workDir }));
  }

  // Stitch the scenes, then mux the voiceover (or a silent track - some
  // platforms reject videos with no audio stream at all).
  const listFile = path.join(workDir, "concat.txt");
  fs.writeFileSync(listFile, sceneFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));

  const args = ["-y", "-f", "concat", "-safe", "0", "-i", listFile];
  if (voiceover) args.push("-i", voiceover);
  else args.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");
  args.push(
    "-map", "0:v", "-map", "1:a",
    "-c:v", "copy",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-shortest", "-movflags", "+faststart",
    outputPath
  );
  await run(config.ffmpegPath, args);

  return { outputPath, durationSeconds: await probeDuration(outputPath) };
}
