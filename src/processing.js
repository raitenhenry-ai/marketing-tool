import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import config from "./config.js";
import { q, q1, run as dbRun } from "./db.js";
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
    "-show_entries", "format=duration:stream=width,height,r_frame_rate",
    "-of", "json",
    filePath,
  ]);
  const data = JSON.parse(out);
  const [num, den] = String(data.streams?.[0]?.r_frame_rate || "30/1").split("/").map(Number);
  return {
    duration: Number(data.format?.duration || 0),
    width: Number(data.streams?.[0]?.width || 1920),
    height: Number(data.streams?.[0]?.height || 1080),
    fps: den ? num / den : 30,
  };
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i], i);
      }
    })
  );
  return results;
}

function buildArgs({ inputPath, outputPath, start, length, overlayAssPath, subsAssPath, out, source }) {
  const args = ["-y", "-ss", String(start), "-i", inputPath, "-t", String(length)];
  // Badges first, then subtitles on top.
  let text = `ass='${escapeFilterPath(overlayAssPath)}'`;
  if (subsAssPath) text += `,ass='${escapeFilterPath(subsAssPath)}'`;

  // 60fps sources encode at half speed for no benefit on short-form feeds.
  const fpsCap = source?.fps > 31 ? "fps=30," : "";

  if (config.verticalFormat) {
    // Vertical canvas: darkened, blurred cover-fit background with the
    // original video fitted on top, then the badge/subtitle overlays.
    // The background is blurred at quarter resolution and scaled back up:
    // visually identical (blur destroys detail anyway) and drastically
    // cheaper than blurring the full frame.
    const { width: W, height: H } = out;
    const bw = Math.round(W / 8) * 2;
    const bh = Math.round(H / 8) * 2;
    args.push(
      "-filter_complex_threads", String(os.availableParallelism?.() || 4),
      "-filter_complex",
      `[0:v]${fpsCap}split=2[bg][fg];` +
        `[bg]scale=${bw}:${bh}:force_original_aspect_ratio=increase,crop=${bw}:${bh},` +
        `boxblur=8:2,eq=brightness=-0.08:saturation=0.85,scale=${W}:${H}[bgb];` +
        `[fg]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=bicubic[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${text}[v]`,
      "-map", "[v]", "-map", "0:a?"
    );
  } else {
    args.push("-vf", `${fpsCap}${text}`);
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
export async function recoverStuckVideos() {
  const stuck = await q("SELECT id FROM videos WHERE status = 'processing'");
  for (const video of stuck) {
    console.log(`[processing] re-queueing video ${video.id} left in 'processing' state`);
    enqueueProcessing(video.id);
  }
  return stuck.length;
}

export async function processVideo(videoId) {
  const video = await q1("SELECT * FROM videos WHERE id = ?", [videoId]);
  if (!video) return;

  // A re-run (crash recovery or manual retry) starts from a clean slate.
  await dbRun("DELETE FROM clips WHERE video_id = ?", [videoId]);

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

    const out = config.verticalFormat
      ? { width: Math.round((config.verticalHeight * 9) / 16 / 2) * 2, height: config.verticalHeight }
      : { width: source.width, height: source.height };

    // Phase 1 - network-bound: transcribe every clip window and generate its
    // metadata in parallel (capped), so the CPU-bound encode phase never
    // sits idle waiting on API calls.
    const assets = await mapLimit(segments, 4, async ({ start, end }, i) => {
      const length = end - start;
      const outBase = path.join(config.clipsDir, `video${video.id}-part${i + 1}`);

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
        } catch (err) {
          console.warn(
            `[processing] video ${video.id} part ${i + 1}: metadata skipped -`,
            err.message || err
          );
        }
      }

      return { overlayAssPath, subsAssPath, meta };
    });

    // Phase 2 - CPU-bound: encode the clips one after another.
    const clipRows = [];
    for (let i = 0; i < totalParts; i++) {
      const { start, end } = segments[i];
      const length = end - start;
      const filename = `video${video.id}-part${i + 1}.mp4`;
      const outputPath = path.join(config.clipsDir, filename);

      const t0 = Date.now();
      await run(
        config.ffmpegPath,
        buildArgs({
          inputPath: video.path,
          outputPath,
          start,
          length,
          overlayAssPath: assets[i].overlayAssPath,
          subsAssPath: assets[i].subsAssPath,
          out,
          source,
        })
      );
      console.log(
        `[processing] video ${video.id} part ${i + 1}/${totalParts}: ` +
          `${Math.round(length)}s clip encoded in ${((Date.now() - t0) / 1000).toFixed(1)}s`
      );
      clipRows.push({ part: i + 1, totalParts, filename, length, meta: assets[i].meta });
    }

    // Schedule only after every clip rendered successfully: part 1 goes out
    // now, each following part 3 hours (uploadIntervalHours) after the last.
    const now = Date.now();
    for (const clip of clipRows) {
      await dbRun(
        `INSERT INTO clips (video_id, part_number, total_parts, filename, duration_seconds, scheduled_at, created_at,
                            gen_title, gen_description, gen_hashtags)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [video.id, clip.part, clip.totalParts, clip.filename, clip.length,
         now + (clip.part - 1) * intervalMs, now,
         clip.meta?.title ?? null,
         clip.meta?.description ?? null,
         clip.meta?.hashtags?.length ? JSON.stringify(clip.meta.hashtags) : null]
      );
    }

    await dbRun("UPDATE videos SET status = 'ready', duration_seconds = ?, error = NULL WHERE id = ?",
      [source.duration, video.id]);
    console.log(`[processing] video ${video.id}: ${totalParts} clip(s) ready`);
  } catch (err) {
    console.error(`[processing] video ${video.id} failed:`, err);
    await dbRun("UPDATE videos SET status = 'failed', error = ? WHERE id = ?",
      [String(err.message || err), video.id]);
  }
}
