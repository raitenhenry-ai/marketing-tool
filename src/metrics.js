import db from "./db.js";
import { freshAccount } from "./scheduler.js";
import * as youtube from "./platforms/youtube.js";
import * as instagram from "./platforms/instagram.js";
import * as tiktok from "./platforms/tiktok.js";

const REFRESH_INTERVAL_MS = 6 * 3600 * 1000;

let running = false;
let lastRun = null;

const saveMetrics = () =>
  db.prepare("UPDATE uploads SET metrics_json = ?, metrics_at = ? WHERE id = ?");

// Pulls views/likes/comments/... for every published upload, per account.
// Failures are per-account (a broken token on one account never blocks the
// others) and per-post where the platform allows it.
export async function refreshMetrics() {
  if (running) return { started: false, reason: "already running" };
  running = true;
  const startedAt = Date.now();
  try {
    const uploads = db.prepare(
      `SELECT uploads.*, accounts.platform AS platform_name
       FROM uploads JOIN accounts ON accounts.id = uploads.account_id
       WHERE uploads.status = 'done' AND uploads.platform_video_id IS NOT NULL`
    ).all();

    const byAccount = new Map();
    for (const u of uploads) {
      if (!byAccount.has(u.account_id)) byAccount.set(u.account_id, []);
      byAccount.get(u.account_id).push(u);
    }

    let updated = 0;
    for (const [accountId, rows] of byAccount) {
      try {
        const account = await freshAccount(accountId);
        if (!account) continue;
        updated += await refreshForAccount(account, rows);
      } catch (err) {
        console.warn(
          `[metrics] account ${accountId} (${rows[0]?.platform_name}) failed:`,
          err.message || err
        );
      }
    }
    lastRun = Date.now();
    console.log(
      `[metrics] refreshed ${updated}/${uploads.length} post(s) in ${Math.round((Date.now() - startedAt) / 1000)}s`
    );
    return { started: true, updated, total: uploads.length };
  } finally {
    running = false;
  }
}

async function refreshForAccount(account, rows) {
  const now = Date.now();
  const save = saveMetrics();
  let updated = 0;

  if (account.platform === "youtube") {
    const ids = rows.map((r) => r.platform_video_id);
    const stats = await youtube.fetchStats(account, ids);
    for (const row of rows) {
      const s = stats[row.platform_video_id];
      if (s) { save.run(JSON.stringify(s), now, row.id); updated++; }
    }
  } else if (account.platform === "instagram") {
    const stats = await instagram.fetchStats(account, rows.map((r) => r.platform_video_id));
    for (const row of rows) {
      const s = stats[row.platform_video_id];
      if (s) { save.run(JSON.stringify(s), now, row.id); updated++; }
    }
  } else if (account.platform === "tiktok") {
    // Resolve public post ids for uploads that only have the publish id yet.
    const setPostId = db.prepare("UPDATE uploads SET public_post_id = ? WHERE id = ?");
    for (const row of rows) {
      if (!row.public_post_id) {
        const postId = await tiktok.resolvePostId(account, row.platform_video_id);
        if (postId) { setPostId.run(postId, row.id); row.public_post_id = postId; }
      }
    }
    const resolvable = rows.filter((r) => r.public_post_id);
    if (resolvable.length) {
      const stats = await tiktok.fetchStats(account, resolvable.map((r) => r.public_post_id));
      for (const row of resolvable) {
        const s = stats[row.public_post_id];
        if (s) { save.run(JSON.stringify(s), now, row.id); updated++; }
      }
    }
  }
  return updated;
}

export function metricsStatus() {
  return { running, lastRun };
}

export function startMetrics() {
  setInterval(() => refreshMetrics().catch((e) => console.error("[metrics]", e)), REFRESH_INTERVAL_MS);
  // First pass shortly after boot so the dashboard fills in quickly.
  setTimeout(() => refreshMetrics().catch((e) => console.error("[metrics]", e)), 30 * 1000);
}
