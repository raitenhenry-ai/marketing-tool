import { spawn } from "node:child_process";
import path from "node:path";
import config from "./config.js";
import db from "./db.js";
import { subtitlesEnabled, generateClipSubtitles } from "./transcribe.js";
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

function escapeDrawtext(text) {
  return text.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:").replace(/%/g, "\\%");
}

function buildFilter({ partLabel, outHeight }) {
  const font = config.fontPath ? `fontfile='${config.fontPath}':` : "";
  const partSize = Math.round(outHeight * 0.045);
  const domainSize = Math.round(outHeight * 0.03);
  const margin = Math.round(outHeight * 0.06);
  const box = "box=1:boxcolor=black@0.45:boxborderw=14";

  const drawParts = [];
  if (partLabel) {
    drawParts.push(
      `drawtext=${font}text='${escapeDrawtext(partLabel)}':fontsize=${partSize}:fontcolor=white:` +
        `x=(w-text_w)/2:y=${margin}:${box}`
    );
  }
  drawParts.push(
    `drawtext=${font}text='${escapeDrawtext(config.siteDomain)}':fontsize=${domainSize}:fontcolor=white:` +
      `x=(w-text_w)/2:y=h-${margin}-text_h:${box}`
  );
  return drawParts.join(",");
}

function escapeFilterPath(p) {
  return p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function buildArgs({ inputPath, outputPath, start, length, partLabel, source, assPath }) {
  const args = ["-y", "-ss", String(start), "-i", inputPath, "-t", String(length)];
  // Subtitles go last in the chain so they render on top of everything.
  const subs = assPath ? `,ass='${escapeFilterPath(assPath)}'` : "";

  if (config.verticalFormat) {
    // 1080x1920 canvas: darkened, heavily blurred cover-fit background with
    // the original video fitted on top (Lanczos scale + mild sharpen so it
    // stays crisp), then the text overlays.
    const overlays = buildFilter({ partLabel, outHeight: 1920 });
    args.push(
      "-filter_complex",
      `[0:v]split=2[bg][fg];` +
        `[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,` +
        `boxblur=32:6,eq=brightness=-0.08:saturation=0.85[bgb];` +
        `[fg]scale=1080:1920:force_original_aspect_ratio=decrease:flags=lanczos,` +
        `unsharp=5:5:0.3:5:5:0.0[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2,${overlays}${subs}[v]`,
      "-map", "[v]", "-map", "0:a?"
    );
  } else {
    args.push("-vf", buildFilter({ partLabel, outHeight: source.height }) + subs);
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

export async function processVideo(videoId) {
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId);
  if (!video) return;

  try {
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
      `INSERT INTO clips (video_id, part_number, total_parts, filename, duration_seconds, scheduled_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    );

    const out = config.verticalFormat
      ? { width: 1080, height: 1920 }
      : { width: source.width, height: source.height };

    const clipRows = [];
    for (let i = 0; i < totalParts; i++) {
      const { start, end } = segments[i];
      const length = end - start;
      const partLabel = totalParts > 1 ? `Part ${i + 1}` : null;
      const filename = `video${video.id}-part${i + 1}.mp4`;
      const outputPath = path.join(config.clipsDir, filename);

      let assPath = null;
      if (subtitlesEnabled()) {
        try {
          assPath = await generateClipSubtitles({
            inputPath: video.path,
            start,
            length,
            outBase: path.join(config.clipsDir, `video${video.id}-part${i + 1}`),
            width: out.width,
            height: out.height,
          });
        } catch (err) {
          console.warn(
            `[processing] video ${video.id} part ${i + 1}: subtitles skipped -`,
            err.message || err
          );
        }
      }

      await run(
        config.ffmpegPath,
        buildArgs({ inputPath: video.path, outputPath, start, length, partLabel, source, assPath })
      );
      clipRows.push({ part: i + 1, totalParts, filename, length });
    }

    // Schedule only after every clip rendered successfully: part 1 goes out
    // now, each following part 3 hours (uploadIntervalHours) after the last.
    const now = Date.now();
    for (const clip of clipRows) {
      insertClip.run(
        video.id, clip.part, clip.totalParts, clip.filename, clip.length,
        now + (clip.part - 1) * intervalMs, now
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
