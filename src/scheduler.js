import config from "./config.js";
import { q, q1, run } from "./db.js";
import path from "node:path";
import * as youtube from "./platforms/youtube.js";
import * as instagram from "./platforms/instagram.js";
import * as tiktok from "./platforms/tiktok.js";
import * as facebook from "./platforms/facebook.js";
import * as x from "./platforms/x.js";

export const platforms = { youtube, instagram, tiktok, facebook, x };

const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10 * 60 * 1000;
const TICK_MS = 60 * 1000;

let running = false;

// Returns the account a video publishes to on this platform, assigning the
// least-used connected account on first need. All clips of the video reuse
// the same assignment.
async function accountForVideo(videoId, platform) {
  const assigned = await q1(
    `SELECT accounts.* FROM video_accounts
     JOIN accounts ON accounts.id = video_accounts.account_id
     WHERE video_accounts.video_id = ? AND video_accounts.platform = ?`,
    [videoId, platform]
  );
  if (assigned) return assigned;

  const leastUsed = await q1(
    `SELECT accounts.*, COUNT(video_accounts.video_id) AS use_count
     FROM accounts
     LEFT JOIN video_accounts ON video_accounts.account_id = accounts.id
     WHERE accounts.platform = ?
     GROUP BY accounts.id
     ORDER BY use_count ASC, accounts.id ASC
     LIMIT 1`,
    [platform]
  );
  if (!leastUsed) return null;

  await run(
    `INSERT INTO video_accounts (video_id, platform, account_id, assigned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (video_id, platform) DO NOTHING`,
    [videoId, platform, leastUsed.id, Date.now()]
  );
  console.log(
    `[scheduler] video ${videoId} -> ${platform} account "${leastUsed.display_name}" (#${leastUsed.id})`
  );
  return leastUsed;
}

// Refresh the access token if it expires within the next 5 minutes.
export async function freshAccount(accountId) {
  const account = await q1("SELECT * FROM accounts WHERE id = ?", [accountId]);
  if (!account) return null;

  if (account.expires_at && Number(account.expires_at) < Date.now() + 5 * 60 * 1000) {
    if (account.platform !== "instagram" && !account.refresh_token) return account;
    const updated = await platforms[account.platform].refresh(account);
    await run(
      "UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?",
      [updated.accessToken, updated.refreshToken ?? account.refresh_token, updated.expiresAt, account.id]
    );
    return q1("SELECT * FROM accounts WHERE id = ?", [account.id]);
  }
  return account;
}

// Builds the YouTube title and the caption/description text for a clip,
// preferring the AI-generated metadata and falling back to "<video> - Part N".
export function textsFor(video, clip) {
  const part = clip.total_parts > 1 ? ` - Part ${clip.part_number}/${clip.total_parts}` : "";
  const hashtags = JSON.parse(clip.gen_hashtags || "[]").join(" ");

  if (clip.gen_title) {
    const caption = [
      `${clip.gen_title}${part}`,
      clip.gen_description || "",
      hashtags,
      config.siteDomain,
    ].filter(Boolean).join("\n\n");
    return {
      // YouTube titles are capped at 100 characters.
      title: `${clip.gen_title}${part} #Shorts`.slice(0, 100),
      caption,
    };
  }

  return {
    title: `${video.title}${part} #Shorts`.slice(0, 100),
    caption: `${video.title}${part}\n\n${config.siteDomain}`,
  };
}

async function publish(accountRow, clip, video) {
  await run(
    `INSERT INTO uploads (clip_id, account_id, platform, status, attempts, next_attempt_at)
     VALUES (?, ?, ?, 'uploading', 1, NULL)
     ON CONFLICT (clip_id, account_id) DO UPDATE SET
       status = 'uploading', attempts = uploads.attempts + 1, next_attempt_at = NULL`,
    [clip.id, accountRow.id, accountRow.platform]
  );

  try {
    const account = await freshAccount(accountRow.id);
    if (!account) throw new Error("account disconnected");

    const filePath = path.join(config.clipsDir, clip.filename);
    const publicUrl = `${config.baseUrl}/clips/${encodeURIComponent(clip.filename)}`;
    const { title, caption } = textsFor(video, clip);
    const ctx = { filePath, publicUrl, title, caption, description: caption };

    let platformVideoId;
    try {
      platformVideoId = await platforms[account.platform].uploadClip(account, ctx);
    } catch (err) {
      // Tokens can be invalidated before their recorded expiry (revoked, or a
      // Google app in "Testing" mode). On an auth error, force-refresh the
      // token and retry once before giving up.
      const unauthorized = /\(401\)|unauthorized|invalid.?token|token.*expired/i
        .test(String(err.message || err));
      const canRefresh =
        unauthorized && (account.refresh_token || account.platform === "instagram");
      if (!canRefresh) throw err;

      const updated = await platforms[account.platform].refresh(account);
      await run(
        "UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?",
        [updated.accessToken, updated.refreshToken ?? account.refresh_token, updated.expiresAt, account.id]
      );
      const freshed = await q1("SELECT * FROM accounts WHERE id = ?", [account.id]);
      console.log(
        `[scheduler] ${account.platform}/${account.display_name}: token rejected, refreshed and retrying`
      );
      platformVideoId = await platforms[freshed.platform].uploadClip(freshed, ctx);
    }

    await run(
      `UPDATE uploads SET status = 'done', platform_video_id = ?, error = NULL, uploaded_at = ?
       WHERE clip_id = ? AND account_id = ?`,
      [String(platformVideoId ?? ""), Date.now(), clip.id, account.id]
    );
    console.log(
      `[scheduler] clip ${clip.id} (part ${clip.part_number}) -> ${account.platform}/${account.display_name} OK`
    );
  } catch (err) {
    const row = await q1(
      "SELECT attempts FROM uploads WHERE clip_id = ? AND account_id = ?",
      [clip.id, accountRow.id]
    );
    const exhausted = (row?.attempts ?? 1) >= MAX_ATTEMPTS;
    await run(
      `UPDATE uploads SET status = 'failed', error = ?, next_attempt_at = ?
       WHERE clip_id = ? AND account_id = ?`,
      [String(err.message || err), exhausted ? null : Date.now() + RETRY_DELAY_MS, clip.id, accountRow.id]
    );
    console.error(
      `[scheduler] clip ${clip.id} -> ${accountRow.platform}/${accountRow.display_name} failed:`,
      err.message || err
    );
  }
}

// After downtime, several parts of a video can be overdue at once. Without
// correction they'd all publish in the same minute, defeating the spacing.
// Re-space each video's untouched (never-attempted) clips so consecutive
// parts stay uploadIntervalHours apart, anchored at the next possible slot.
export async function reflowOverdueClips(now = Date.now()) {
  const intervalMs = config.uploadIntervalHours * 3600 * 1000;
  const videos = await q(
    `SELECT DISTINCT clips.video_id AS video_id FROM clips
     JOIN videos ON videos.id = clips.video_id
     WHERE videos.status = 'ready' AND videos.publish_mode = 'auto' AND clips.scheduled_at <= ?
       AND NOT EXISTS (SELECT 1 FROM uploads WHERE uploads.clip_id = clips.id)`,
    [now]
  );

  let moved = 0;
  for (const { video_id: videoId } of videos) {
    const untouched = await q(
      `SELECT clips.id, clips.part_number, clips.scheduled_at FROM clips
       WHERE clips.video_id = ?
         AND NOT EXISTS (SELECT 1 FROM uploads WHERE uploads.clip_id = clips.id)
       ORDER BY clips.part_number ASC`,
      [videoId]
    );
    if (untouched.length < 2) continue;

    // The earliest pending part keeps its slot (publishing now if overdue);
    // every later part is pushed to at least one interval after the previous.
    let prevTime = Math.max(Number(untouched[0].scheduled_at), 0) <= now
      ? now
      : Number(untouched[0].scheduled_at);
    for (let i = 1; i < untouched.length; i++) {
      const minTime = prevTime + intervalMs;
      const current = Number(untouched[i].scheduled_at);
      if (current < minTime) {
        await run("UPDATE clips SET scheduled_at = ? WHERE id = ?", [minTime, untouched[i].id]);
        moved++;
        prevTime = minTime;
      } else {
        prevTime = current;
      }
    }
  }
  if (moved) {
    console.log(`[scheduler] re-spaced ${moved} overdue clip(s) to keep the ${config.uploadIntervalHours}h gap`);
  }
  return moved;
}

// Accounts with a posting cadence set ignore the global clip timeline: they
// post the next pending part of their assigned videos at their own rhythm
// (e.g. every 30 minutes on X, every 2 hours on YouTube). One post per
// cadence window; part order within a video is always preserved.
async function cadencePublish(account, now) {
  const gapMs = Number(account.min_gap_hours) * 3600 * 1000;
  const last = await q1(
    "SELECT MAX(uploaded_at) AS t FROM uploads WHERE account_id = ? AND status = 'done'",
    [account.id]
  );
  if (Number(last?.t || 0) && now - Number(last.t) < gapMs) return;

  // Next eligible clip: assigned to this account, not yet posted/in-flight
  // here (a failed-with-retry attempt becomes eligible again once its retry
  // time passes), and with every earlier part of the same video settled
  // (posted, or given up after all retries so it can't block forever).
  const clip = await q1(
    `SELECT clips.*, videos.title FROM clips
     JOIN videos ON videos.id = clips.video_id
     JOIN video_accounts va ON va.video_id = videos.id AND va.platform = ? AND va.account_id = ?
     WHERE videos.status = 'ready' AND videos.publish_mode = 'auto'
       AND NOT EXISTS (
         SELECT 1 FROM uploads u WHERE u.clip_id = clips.id AND u.account_id = ?
           AND (u.status IN ('done', 'uploading')
                OR (u.status = 'failed' AND (u.next_attempt_at IS NULL OR u.next_attempt_at > ?)))
       )
       AND NOT EXISTS (
         SELECT 1 FROM clips c2 WHERE c2.video_id = clips.video_id AND c2.part_number < clips.part_number
           AND NOT EXISTS (
             SELECT 1 FROM uploads u2 WHERE u2.clip_id = c2.id AND u2.account_id = ?
               AND (u2.status = 'done' OR (u2.status = 'failed' AND u2.next_attempt_at IS NULL))
           )
       )
     ORDER BY videos.created_at ASC, clips.part_number ASC LIMIT 1`,
    [account.platform, account.id, account.id, now, account.id]
  );
  if (clip) await publish(account, clip, { title: clip.title });
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const activePlatforms = (await q("SELECT DISTINCT platform FROM accounts")).map((a) => a.platform);
    if (!activePlatforms.length) return;

    await reflowOverdueClips();
    const now = Date.now();

    // Make sure every ready auto video has an account assigned on each
    // platform (rotation, least-used first) so cadence accounts can see
    // their queue even before the global timeline makes clips due.
    const autoVideos = await q(
      "SELECT id FROM videos WHERE status = 'ready' AND publish_mode = 'auto'"
    );
    for (const video of autoVideos) {
      for (const platform of activePlatforms) {
        await accountForVideo(video.id, platform);
      }
    }

    // Cadence-driven accounts post at their own rhythm.
    const accounts = await q("SELECT * FROM accounts");
    for (const account of accounts) {
      if (Number(account.min_gap_hours || 0) > 0) {
        await cadencePublish(account, now);
      }
    }

    // Default-schedule accounts follow the global clip timeline.
    const dueClips = await q(
      `SELECT clips.*, videos.title FROM clips
       JOIN videos ON videos.id = clips.video_id
       WHERE videos.status = 'ready' AND videos.publish_mode = 'auto' AND clips.scheduled_at <= ?
       ORDER BY clips.scheduled_at ASC`,
      [now]
    );

    for (const clip of dueClips) {
      for (const platform of activePlatforms) {
        const account = await accountForVideo(clip.video_id, platform);
        if (!account) continue;
        if (Number(account.min_gap_hours || 0) > 0) continue; // cadence handles it

        const upload = await q1(
          "SELECT * FROM uploads WHERE clip_id = ? AND account_id = ?",
          [clip.id, account.id]
        );
        const retryDue =
          upload?.status === "failed" &&
          upload.next_attempt_at != null &&
          Number(upload.next_attempt_at) <= Date.now();
        if (upload && !retryDue) continue;

        await publish(account, clip, { title: clip.title });
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
