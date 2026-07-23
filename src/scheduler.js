import config from "./config.js";
import db from "./db.js";
import path from "node:path";
import * as youtube from "./platforms/youtube.js";
import * as instagram from "./platforms/instagram.js";
import * as tiktok from "./platforms/tiktok.js";

const platforms = { youtube, instagram, tiktok };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const TICK_MS = 60 * 1000;

let running = false;

async function freshAccount(platform) {
  const account = db.prepare("SELECT * FROM accounts WHERE platform = ?").get(platform);
  if (!account) return null;

  // Refresh access tokens that expire within the next 5 minutes.
  if (account.expires_at && account.expires_at < Date.now() + 5 * 60 * 1000) {
    if (platform !== "instagram" && !account.refresh_token) return account;
    const updated = await platforms[platform].refresh(account);
    db.prepare(
      "UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE platform = ?"
    ).run(updated.accessToken, updated.refreshToken ?? account.refresh_token, updated.expiresAt, platform);
    return db.prepare("SELECT * FROM accounts WHERE platform = ?").get(platform);
  }
  return account;
}

function captionFor(video, clip) {
  const part = clip.total_parts > 1 ? ` - Part ${clip.part_number}` : "";
  return `${video.title}${part}\n\n${config.siteDomain}`;
}

async function publish(platform, clip, video) {
  const upsert = db.prepare(
    `INSERT INTO uploads (clip_id, platform, status, attempts, next_attempt_at)
     VALUES (?, ?, 'uploading', 1, NULL)
     ON CONFLICT (clip_id, platform) DO UPDATE SET
       status = 'uploading', attempts = attempts + 1, next_attempt_at = NULL`
  );
  upsert.run(clip.id, platform);

  try {
    const account = await freshAccount(platform);
    if (!account) throw new Error("account disconnected");

    const filePath = path.join(config.clipsDir, clip.filename);
    const publicUrl = `${config.baseUrl}/clips/${encodeURIComponent(clip.filename)}`;
    const part = clip.total_parts > 1 ? ` - Part ${clip.part_number}` : "";
    const caption = captionFor(video, clip);

    let platformVideoId;
    if (platform === "youtube") {
      platformVideoId = await youtube.uploadClip(account, {
        filePath,
        title: `${video.title}${part} #Shorts`,
        description: caption,
      });
    } else if (platform === "instagram") {
      platformVideoId = await instagram.uploadClip(account, { publicUrl, caption });
    } else {
      platformVideoId = await tiktok.uploadClip(account, { filePath, title: caption });
    }

    db.prepare(
      `UPDATE uploads SET status = 'done', platform_video_id = ?, error = NULL, uploaded_at = ?
       WHERE clip_id = ? AND platform = ?`
    ).run(String(platformVideoId ?? ""), Date.now(), clip.id, platform);
    console.log(`[scheduler] clip ${clip.id} (part ${clip.part_number}) -> ${platform} OK`);
  } catch (err) {
    const row = db.prepare("SELECT attempts FROM uploads WHERE clip_id = ? AND platform = ?")
      .get(clip.id, platform);
    const exhausted = (row?.attempts ?? 1) >= MAX_ATTEMPTS;
    db.prepare(
      `UPDATE uploads SET status = 'failed', error = ?, next_attempt_at = ?
       WHERE clip_id = ? AND platform = ?`
    ).run(String(err.message || err), exhausted ? null : Date.now() + RETRY_DELAY_MS, clip.id, platform);
    console.error(`[scheduler] clip ${clip.id} -> ${platform} failed:`, err.message || err);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const accounts = db.prepare("SELECT platform FROM accounts").all().map((a) => a.platform);
    if (!accounts.length) return;

    const dueClips = db.prepare(
      `SELECT clips.*, videos.title, videos.status AS video_status
       FROM clips JOIN videos ON videos.id = clips.video_id
       WHERE videos.status = 'ready' AND clips.scheduled_at <= ?
       ORDER BY clips.scheduled_at ASC`
    ).all(Date.now());

    for (const clip of dueClips) {
      for (const platform of accounts) {
        const upload = db.prepare(
          "SELECT * FROM uploads WHERE clip_id = ? AND platform = ?"
        ).get(clip.id, platform);
        const retryDue =
          upload?.status === "failed" &&
          upload.next_attempt_at != null &&
          upload.next_attempt_at <= Date.now();
        if (upload && !retryDue) continue;

        await publish(platform, clip, { title: clip.title });
      }
    }
  } catch (err) {
    console.error("[scheduler] tick failed:", err);
  } finally {
    running = false;
  }
}

export function startScheduler() {
  setInterval(tick, TICK_MS);
  tick();
  console.log(
    `[scheduler] started - publishing due clips every minute, parts spaced ${config.uploadIntervalHours}h apart`
  );
}
