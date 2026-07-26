import fs from "node:fs";
import path from "node:path";
import config from "./config.js";
import { q, run as dbRun } from "./db.js";

const DAY_MS = 24 * 3600 * 1000;
const TICK_MS = 6 * 3600 * 1000;

// Removes every file belonging to a video: the original upload plus each
// clip's mp4 and subtitle/overlay sidecars. Used by delete, prune and the
// originals cleanup.
export async function deleteVideoFiles(video, { clipsOnly = false } = {}) {
  if (!clipsOnly && video.path) fs.rmSync(video.path, { force: true });
  const clips = await q("SELECT filename FROM clips WHERE video_id = ?", [video.id]);
  for (const clip of clips) {
    const base = path.join(config.clipsDir, clip.filename.replace(/\.mp4$/, ""));
    for (const suffix of [".mp4", ".ass", ".overlay.ass"]) {
      fs.rmSync(`${base}${suffix}`, { force: true });
    }
  }
}

async function tick() {
  const now = Date.now();
  try {
    // Delete original source files once a video has been processed and has
    // aged past the retention window (clips are what get published; the
    // original is only needed for re-processing).
    if (config.deleteOriginalsAfterDays > 0) {
      const cutoff = now - config.deleteOriginalsAfterDays * DAY_MS;
      const videos = await q(
        "SELECT id, path FROM videos WHERE status = 'ready' AND created_at < ?", [cutoff]
      );
      for (const video of videos) {
        if (video.path && fs.existsSync(video.path)) {
          fs.rmSync(video.path, { force: true });
          console.log(`[cleanup] removed original for video ${video.id}`);
        }
      }
    }

    // Optionally prune whole videos (rows + all files) long after every clip
    // has passed its publish time. Disabled by default.
    if (config.pruneVideosAfterDays > 0) {
      const cutoff = now - config.pruneVideosAfterDays * DAY_MS;
      const videos = await q(
        `SELECT * FROM videos
         WHERE created_at < ?
           AND NOT EXISTS (SELECT 1 FROM clips WHERE clips.video_id = videos.id AND clips.scheduled_at > ?)`,
        [cutoff, now]
      );
      for (const video of videos) {
        await deleteVideoFiles(video);
        await dbRun("DELETE FROM videos WHERE id = ?", [video.id]);
        console.log(`[cleanup] pruned video ${video.id} ("${video.title}")`);
      }
    }
  } catch (err) {
    console.error("[cleanup] tick failed:", err);
  }
}

export function startCleanup() {
  setInterval(() => tick().catch((e) => console.error("[cleanup]", e)), TICK_MS);
  tick().catch((e) => console.error("[cleanup]", e));
}
