import { spawn } from "node:child_process";
import path from "node:path";
import config from "./config.js";
import db from "./db.js";
import fs from "node:fs";
import { subtitlesEnabled, generateClipSubtitles } from "./transcribe.js";
import { metadataEnabled, generateClipMetadata } from "./metadata.js";
import { buildOverlayAss } from "./overlays.js";
import { resolveSegments } from "./cuts.js";

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-2000)}`));
    });
  });
}

async function probe(filePath) {
  const out = await run(config.ffprobePath, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "format=duration:stream=width,height",
    "-of", "json",
    filePath,
  ]);
  const data = JSON.parse(out);
  return {
    duration: Number(data.format?.duration || 0),
    width: Number(data.streams?.[0]?.width || 1920),
    height: Number(data.streams?.[0]?.height || 1080),
  };
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildArgs({ inputPath, outputPath, start, length, overlayAssPath, subsAssPath }) {
  const args = ["-y", "-ss", String(start), "-i", inputPath, "-t", String(length)];
  // Badges first, then subtitles on top.
  let text = `ass='${escapeFilterPath(overlayAssPath)}'`;
  if (subsAssPath) text += `,ass='${escapeFilterPath(subsAssPath)}'`;

  if (config.verticalFormat) {
    // 1080x1920 canvas: darkened, heavily blurred cover-fit background with
    // the original video fitted on top (Lanczos scale + mild sharpen so it
    // stays crisp), then the badge/subtitle overlays.
    args.push(
      "-filter_complex",
      `[0:v]split=2[bg][fg];` +
        `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
        `boxblur=32:6,eq=brightness=-0.08:saturation=0.85[bgb];` +
        `[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `unsharp=5:5:0.3:5:5:0.0[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${text}[v]`,
      "-map", "[v]", "-map", "0:a?"
    );
  } else {
    args.push("-vf", text);
  }

  args.push(
    "-c:v", "libx264", "-preset", config.videoPreset, "-crf", String(config.videoCrf),
    "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "192k", "-ar", "48000"
  );
  if (config.normalizeAudio) {
    // Match the -14 LUFS loudness target the platforms normalize to.
    args.push("-af", "loudnorm=I=-14:TP=-1.5:LRA=11");
  }
  args.push("-movflags", "+faststart", outputPath);
  return args;
}

// Videos are encoded one at a time: parallel ffmpeg runs thrash small
// servers and make every video slower. The queue drains in FIFO order.
const queue = [];
let draining = false;

export function enqueueProcessing(videoId) {
  queue.push(videoId);
  drain();
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      await processVideo(queue.shift());
    }
  } finally {
    draining = false;
  }
}

export function queueLength() {
  return queue.length + (draining ? 1 : 0);
}

// Re-queue videos that were mid-processing when the server last stopped.
export function recoverStuckVideos() {
  const stuck = db.prepare("SELECT id FROM videos WHERE status = 'processing'").all();
  for (const video of stuck) {
    console.log(`[processing] re-queueing video ${video.id} left in 'processing' state`);
    enqueueProcessing(video.id);
  }
  return stuck.length;
}

export async function processVideo(videoId) {
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId);
  if (!video) return;

  // A re-run (crash recovery or manual retry) starts from a clean slate.
  db.prepare("DELETE FROM clips WHERE video_id = ?").run(videoId);

  try {
    if (!fs.existsSync(video.path)) {
      throw new Error("Original video file is gone (cleaned up or never stored)");
    }
    const source = await probe(video.path);
    if (!source.duration || source.duration <= 0) {
      throw new Error("Could not read video duration");
    }

    // Custom cut times take precedence; otherwise split into equal-length clips.
    let segments;
    if (video.cuts_json) {
      segments = resolveSegments(JSON.parse(video.cuts_json), source.duration);
      if (!segments.length) {
        throw new Error(
          `All cut times fall outside the video (duration ${Math.round(source.duration)}s)`
        );
      }
    } else {
      const clipLen = config.clipDurationSeconds;
      segments = [];
      for (let t = 0; t < source.duration; t += clipLen) {
        segments.push({ start: t, end: Math.min(t + clipLen, source.duration) });
      }
    }
    const totalParts = segments.length;
    const intervalMs = config.uploadIntervalHours * 3600 * 1000;

    const insertClip = db.prepare(
      `INSERT INTO clips (video_id, part_number, total_parts, filename, duration_seconds, scheduled_at, created_at,
                          gen_title, gen_description, gen_hashtags)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const out = config.verticalFormat
      ? { width: 1080, height: 1920 }
      : { width: source.width, height: source.height };

    const clipRows = [];
    for (let i = 0; i < totalParts; i++) {
      const { start, end } = segments[i];
      const length = end - start;
      const outBase = path.join(config.clipsDir, `video${video.id}-part${i + 1}`);
      const filename = `video${video.id}-part${i + 1}.mp4`;
      const outputPath = path.join(config.clipsDir, filename);

      const overlayAssPath = `${outBase}.overlay.ass`;
      fs.writeFileSync(
        overlayAssPath,
        buildOverlayAss({
          partLabel: `Part ${i + 1}/${totalParts}`,
          siteDomain: config.siteDomain,
          width: out.width,
          height: out.height,
          durationSeconds: length,
        })
      );

      let subsAssPath = null;
      let transcript = null;
      if (subtitlesEnabled()) {
        try {
          const subs = await generateClipSubtitles({
            inputPath: video.path,
            start,
            length,
            outBase,
            width: out.width,
            height: out.height,
          });
          if (subs) ({ assPath: subsAssPath, transcript } = subs);
        } catch (err) {
          console.warn(
            `[processing] video ${video.id} part ${i + 1}: subtitles skipped -`,
            err.message || err
          );
        }
      }

      let meta = null;
      if (transcript && metadataEnabled()) {
        try {
          meta = await generateClipMetadata({
            transcript,
            videoTitle: video.title,
            part: i + 1,
            totalParts,
          });
          console.log(`[processing] video ${video.id} part ${i + 1} title: "${meta.title}"`);
        } catch (err) {
          console.warn(
            `[processing] video ${video.id} part ${i + 1}: metadata skipped -`,
            err.message || err
          );
        }
      }

      await run(
        config.ffmpegPath,
        buildArgs({ inputPath: video.path, outputPath, start, length, overlayAssPath, subsAssPath })
      );
      clipRows.push({ part: i + 1, totalParts, filename, length, meta });
    }

    // Schedule only after every clip rendered successfully: part 1 goes out
    // now, each following part 3 hours (uploadIntervalHours) after the last.
    const now = Date.now();
    for (const clip of clipRows) {
      insertClip.run(
        video.id, clip.part, clip.totalParts, clip.filename, clip.length,
        now + (clip.part - 1) * intervalMs, now,
        clip.meta?.title ?? null,
        clip.meta?.description ?? null,
        clip.meta?.hashtags?.length ? JSON.stringify(clip.meta.hashtags) : null
      );
    }

    db.prepare("UPDATE videos SET status = 'ready', duration_seconds = ?, error = NULL WHERE id = ?")
      .run(source.duration, video.id);
    console.log(`[processing] video ${video.id}: ${totalParts} clip(s) ready`);
  } catch (err) {
    console.error(`[processing] video ${video.id} failed:`, err);
    db.prepare("UPDATE videos SET status = 'failed', error = ? WHERE id = ?")
      .run(String(err.message || err), video.id);
  }
}
