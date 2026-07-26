import config from "./config.js";
import db from "./db.js";
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
function accountForVideo(videoId, platform) {
  const assigned = db.prepare(
    `SELECT accounts.* FROM video_accounts
     JOIN accounts ON accounts.id = video_accounts.account_id
     WHERE video_accounts.video_id = ? AND video_accounts.platform = ?`
  ).get(videoId, platform);
  if (assigned) return assigned;

  const leastUsed = db.prepare(
    `SELECT accounts.*, COUNT(video_accounts.video_id) AS load
     FROM accounts
     LEFT JOIN video_accounts ON video_accounts.account_id = accounts.id
     WHERE accounts.platform = ?
     GROUP BY accounts.id
     ORDER BY load ASC, accounts.id ASC
     LIMIT 1`
  ).get(platform);
  if (!leastUsed) return null;

  db.prepare(
    `INSERT INTO video_accounts (video_id, platform, account_id, assigned_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (video_id, platform) DO NOTHING`
  ).run(videoId, platform, leastUsed.id, Date.now());
  console.log(
    `[scheduler] video ${videoId} -> ${platform} account "${leastUsed.display_name}" (#${leastUsed.id})`
  );
  return leastUsed;
}

// Refresh the access token if it expires within the next 5 minutes.
export async function freshAccount(accountId) {
  const account = db.prepare("SELECT * FROM accounts WHERE id = ?").get(accountId);
  if (!account) return null;

  if (account.expires_at && account.expires_at < Date.now() + 5 * 60 * 1000) {
    if (account.platform !== "instagram" && !account.refresh_token) return account;
    const updated = await platforms[account.platform].refresh(account);
    db.prepare(
      "UPDATE accounts SET access_token = ?, refresh_token = ?, expires_at = ? WHERE id = ?"
    ).run(updated.accessToken, updated.refreshToken ?? account.refresh_token, updated.expiresAt, account.id);
    return db.prepare("SELECT * FROM accounts WHERE id = ?").get(account.id);
  }
  return account;
}

// Builds the YouTube title and the caption/description text for a clip,
// preferring the AI-generated metadata and falling back to "<video> - Part N".
function textsFor(video, clip) {
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
  db.prepare(
    `INSERT INTO uploads (clip_id, account_id, platform, status, attempts, next_attempt_at)
     VALUES (?, ?, ?, 'uploading', 1, NULL)
     ON CONFLICT (clip_id, account_id) DO UPDATE SET
       status = 'uploading', attempts = attempts + 1, next_attempt_at = NULL`
  ).run(clip.id, accountRow.id, accountRow.platform);

  try {
    const account = await freshAccount(accountRow.id);
    if (!account) throw new Error("account disconnected");

    const filePath = path.join(config.clipsDir, clip.filename);
    const publicUrl = `${config.baseUrl}/clips/${encodeURIComponent(clip.filename)}`;
    const { title, caption } = textsFor(video, clip);

    const platformVideoId = await platforms[account.platform].uploadClip(account, {
      filePath,
      publicUrl,
      title,
      caption,
      description: caption,
    });

    db.prepare(
      `UPDATE uploads SET status = 'done', platform_video_id = ?, error = NULL, uploaded_at = ?
       WHERE clip_id = ? AND account_id = ?`
    ).run(String(platformVideoId ?? ""), Date.now(), clip.id, account.id);
    console.log(
      `[scheduler] clip ${clip.id} (part ${clip.part_number}) -> ${account.platform}/${account.display_name} OK`
    );
  } catch (err) {
    const row = db.prepare("SELECT attempts FROM uploads WHERE clip_id = ? AND account_id = ?")
      .get(clip.id, accountRow.id);
    const exhausted = (row?.attempts ?? 1) >= MAX_ATTEMPTS;
    db.prepare(
      `UPDATE uploads SET status = 'failed', error = ?, next_attempt_at = ?
       WHERE clip_id = ? AND account_id = ?`
    ).run(
      String(err.message || err),
      exhausted ? null : Date.now() + RETRY_DELAY_MS,
      clip.id,
      accountRow.id
    );
    console.error(
      `[scheduler] clip ${clip.id} -> ${accountRow.platform}/${accountRow.display_name} failed:`,
      err.message || err
    );
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const activePlatforms = db.prepare("SELECT DISTINCT platform FROM accounts").all()
      .map((a) => a.platform);
    if (!activePlatforms.length) return;

    const dueClips = db.prepare(
      `SELECT clips.*, videos.title
       FROM clips JOIN videos ON videos.id = clips.video_id
       WHERE videos.status = 'ready' AND clips.scheduled_at <= ?
       ORDER BY clips.scheduled_at ASC`
    ).all(Date.now());

    for (const clip of dueClips) {
      for (const platform of activePlatforms) {
        const account = accountForVideo(clip.video_id, platform);
        if (!account) continue;

        const upload = db.prepare(
          "SELECT * FROM uploads WHERE clip_id = ? AND account_id = ?"
        ).get(clip.id, account.id);
        const retryDue =
          upload?.status === "failed" &&
          upload.next_attempt_at != null &&
          upload.next_attempt_at <= Date.now();
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
