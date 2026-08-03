import { q, q1, run as dbRun } from "./db.js";
import { freshAccount, platforms } from "./scheduler.js";

const REFRESH_INTERVAL_MS = 6 * 3600 * 1000;

let running = false;
let lastRun = null;

const saveMetric = (json, at, id) =>
  dbRun("UPDATE uploads SET metrics_json = ?, metrics_at = ? WHERE id = ?", [json, at, id]);

// Pulls views/likes/comments/... for every published upload, per account.
// Failures are per-account (a broken token on one account never blocks the
// others) and per-post where the platform allows it.
export async function refreshMetrics() {
  if (running) return { started: false, reason: "already running" };
  running = true;
  const startedAt = Date.now();
  try {
    const uploads = await q(
      `SELECT uploads.*, accounts.platform AS platform_name
       FROM uploads JOIN accounts ON accounts.id = uploads.account_id
       WHERE uploads.status = 'done' AND uploads.platform_video_id IS NOT NULL`
    );

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
  const platform = platforms[account.platform];
  if (!platform?.fetchStats) return 0;
  let updated = 0;

  // Backfill public post ids/permalinks (TikTok's public id, Instagram and
  // Threads permalinks) for any upload that doesn't have one yet.
  if (platform.resolvePostId) {
    for (const row of rows) {
      if (!row.public_post_id) {
        try {
          const postId = await platform.resolvePostId(account, row.platform_video_id);
          if (postId) {
            await dbRun("UPDATE uploads SET public_post_id = ? WHERE id = ?", [postId, row.id]);
            row.public_post_id = postId;
          }
        } catch { /* next cycle */ }
      }
    }
  }

  if (account.platform === "tiktok") {
    const resolvable = rows.filter((r) => r.public_post_id);
    if (resolvable.length) {
      const stats = await platform.fetchStats(account, resolvable.map((r) => r.public_post_id));
      for (const row of resolvable) {
        const s = stats[row.public_post_id];
        if (s) { await saveMetric(JSON.stringify(s), now, row.id); updated++; }
      }
    }
    return updated;
  }

  const stats = await platform.fetchStats(account, rows.map((r) => r.platform_video_id));
  for (const row of rows) {
    const s = stats[row.platform_video_id];
    if (s) { await saveMetric(JSON.stringify(s), now, row.id); updated++; }
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
