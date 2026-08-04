import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import config from "../config.js";
import { q, q1, run as dbRun, dbKind } from "../db.js";
import fs from "node:fs";
import { enqueueProcessing, queueLength } from "../processing.js";
import { subtitlesEnabled } from "../transcribe.js";
import { metadataEnabled } from "../metadata.js";
import { parseCuts } from "../cuts.js";
import { deleteVideoFiles } from "../cleanup.js";
import { authEnabled } from "../auth.js";
import { refreshMetrics, metricsStatus } from "../metrics.js";
import { platforms, textsFor, syncFacebookPages } from "../scheduler.js";
import { postUrl } from "../postUrl.js";

const PLATFORM_KEYS = Object.keys(platforms); // youtube, instagram, tiktok, facebook, x

const router = Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadsDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname || "").toLowerCase() || ".mp4";
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, (file.mimetype || "").startsWith("video/"));
  },
});

// Wraps async handlers so rejections become 500s instead of hung requests.
const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[api] ${req.method} ${req.path} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: String(err.message || err) });
  });

router.get("/accounts", wrap(async (req, res) => {
  const byPlatform = Object.fromEntries(PLATFORM_KEYS.map((k) => [k, []]));
  const rows = await q(
    `SELECT accounts.id, accounts.platform, accounts.display_name, accounts.connected_at,
            accounts.min_gap_hours, COUNT(video_accounts.video_id) AS videos_assigned
     FROM accounts LEFT JOIN video_accounts ON video_accounts.account_id = accounts.id
     GROUP BY accounts.id, accounts.platform, accounts.display_name, accounts.connected_at,
              accounts.min_gap_hours
     ORDER BY accounts.id`
  );
  for (const a of rows) {
    byPlatform[a.platform]?.push({
      id: a.id,
      displayName: a.display_name,
      connectedAt: Number(a.connected_at),
      videosAssigned: Number(a.videos_assigned),
      minGapHours: Number(a.min_gap_hours || 0),
    });
  }
  res.json({
    platforms: Object.fromEntries(PLATFORM_KEYS.map((k) => [
      k, { configured: platforms[k].isConfigured(), accounts: byPlatform[k] },
    ])),
    settings: {
      siteDomain: config.siteDomain,
      clipDurationSeconds: config.clipDurationSeconds,
      uploadIntervalHours: config.uploadIntervalHours,
      maxAccountsPerPlatform: config.maxAccountsPerPlatform,
      subtitlesEnabled: subtitlesEnabled(),
    },
  });
}));

router.patch("/accounts/:id", wrap(async (req, res) => {
  const account = await q1("SELECT id FROM accounts WHERE id = ?", [req.params.id]);
  if (!account) return res.status(404).json({ error: "Account not found" });
  const gap = Number(req.body.minGapHours);
  if (!Number.isFinite(gap) || gap < 0 || gap > 168) {
    return res.status(400).json({ error: "minGapHours must be between 0 and 168" });
  }
  await dbRun("UPDATE accounts SET min_gap_hours = ? WHERE id = ?", [gap, account.id]);
  res.json({ ok: true });
}));

router.post("/videos", upload.single("video"), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file received" });
  const title = (req.body.title || "").trim() || path.parse(req.file.originalname || "video").name;

  let cuts = null;
  try {
    cuts = parseCuts(req.body.cuts);
  } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: String(err.message || err) });
  }

  const publishMode = req.body.publishMode === "auto" ? "auto" : "manual";
  const row = await q1(
    `INSERT INTO videos (title, original_filename, path, status, cuts_json, publish_mode, created_at)
     VALUES (?, ?, ?, 'processing', ?, ?, ?) RETURNING id`,
    [title, req.file.originalname || req.file.filename, req.file.path,
     cuts ? JSON.stringify(cuts) : null, publishMode, Date.now()]
  );

  // Queued (one encode at a time) - progress is visible via GET /api/videos.
  enqueueProcessing(row.id);
  res.json({ id: row.id, status: "processing" });
}));

router.post("/videos/:id/reprocess", wrap(async (req, res) => {
  const video = await q1("SELECT * FROM videos WHERE id = ?", [req.params.id]);
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (video.status !== "failed") {
    return res.status(400).json({ error: "Only failed videos can be reprocessed" });
  }
  await dbRun("UPDATE videos SET status = 'processing', error = NULL WHERE id = ?", [video.id]);
  enqueueProcessing(video.id);
  res.json({ ok: true });
}));

router.get("/videos", wrap(async (req, res) => {
  const videos = await q("SELECT * FROM videos ORDER BY created_at DESC");
  const result = [];
  for (const v of videos) {
    const clips = await q(
      `SELECT id, part_number, total_parts, filename, duration_seconds, scheduled_at,
              gen_title, gen_hashtags
       FROM clips WHERE video_id = ? ORDER BY part_number`,
      [v.id]
    );
    const accounts = await q(
      `SELECT video_accounts.platform, accounts.display_name AS account_name
       FROM video_accounts JOIN accounts ON accounts.id = video_accounts.account_id
       WHERE video_accounts.video_id = ?`,
      [v.id]
    );
    const clipsOut = [];
    for (const c of clips) {
      const uploads = (await q(
        `SELECT uploads.platform, uploads.status, uploads.attempts, uploads.error,
                uploads.platform_video_id, uploads.public_post_id, uploads.uploaded_at,
                accounts.display_name AS account_name
         FROM uploads LEFT JOIN accounts ON accounts.id = uploads.account_id
         WHERE uploads.clip_id = ?`,
        [c.id]
      )).map((u) => ({ ...u, url: u.status === "done" ? postUrl(u) : null }));
      clipsOut.push({
        id: c.id,
        part: c.part_number,
        totalParts: c.total_parts,
        durationSeconds: c.duration_seconds,
        scheduledAt: Number(c.scheduled_at),
        genTitle: c.gen_title,
        genHashtags: JSON.parse(c.gen_hashtags || "[]"),
        url: `/clips/${encodeURIComponent(c.filename)}`,
        uploads,
      });
    }
    result.push({
      id: v.id,
      title: v.title,
      status: v.status,
      error: v.error,
      publishMode: v.publish_mode || "manual",
      durationSeconds: v.duration_seconds,
      createdAt: Number(v.created_at),
      accounts,
      clips: clipsOut,
    });
  }
  res.json(result);
}));

router.delete("/videos/:id", wrap(async (req, res) => {
  const video = await q1("SELECT * FROM videos WHERE id = ?", [req.params.id]);
  if (!video) return res.status(404).json({ error: "Video not found" });
  await deleteVideoFiles(video);
  await dbRun("DELETE FROM videos WHERE id = ?", [video.id]);
  res.json({ ok: true });
}));

router.get("/videos/:id", wrap(async (req, res) => {
  const v = await q1("SELECT * FROM videos WHERE id = ?", [req.params.id]);
  if (!v) return res.status(404).json({ error: "Video not found" });

  const clips = await q("SELECT * FROM clips WHERE video_id = ? ORDER BY part_number", [v.id]);
  const assignments = await q(
    `SELECT video_accounts.platform, accounts.display_name AS account_name, accounts.id AS account_id
     FROM video_accounts JOIN accounts ON accounts.id = video_accounts.account_id
     WHERE video_accounts.video_id = ?`,
    [v.id]
  );

  const clipsOut = [];
  for (const c of clips) {
    const uploads = await q(
      `SELECT uploads.*, accounts.display_name AS account_name
       FROM uploads LEFT JOIN accounts ON accounts.id = uploads.account_id
       WHERE uploads.clip_id = ?`,
      [c.id]
    );
    clipsOut.push({
      id: c.id,
      part: c.part_number,
      totalParts: c.total_parts,
      durationSeconds: c.duration_seconds,
      scheduledAt: Number(c.scheduled_at),
      genTitle: c.gen_title,
      genDescription: c.gen_description,
      genHashtags: JSON.parse(c.gen_hashtags || "[]"),
      url: `/clips/${encodeURIComponent(c.filename)}`,
      uploads: uploads.map((u) => ({
        id: u.id,
        platform: u.platform,
        accountName: u.account_name,
        status: u.status,
        attempts: u.attempts,
        error: u.error,
        platformVideoId: u.platform_video_id,
        url: u.status === "done" ? postUrl(u) : null,
        uploadedAt: u.uploaded_at ? Number(u.uploaded_at) : null,
        nextAttemptAt: u.next_attempt_at ? Number(u.next_attempt_at) : null,
        metrics: u.metrics_json ? JSON.parse(u.metrics_json) : null,
        metricsAt: u.metrics_at ? Number(u.metrics_at) : null,
      })),
    });
  }

  res.json({
    id: v.id,
    title: v.title,
    originalFilename: v.original_filename,
    status: v.status,
    error: v.error,
    publishMode: v.publish_mode || "manual",
    durationSeconds: v.duration_seconds,
    createdAt: Number(v.created_at),
    cuts: v.cuts_json ? JSON.parse(v.cuts_json) : null,
    accounts: assignments,
    clips: clipsOut,
  });
}));

function safeName(text, max = 60) {
  return String(text || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .replace(/[. ]+$/, "") || "untitled";
}

// Streams a well-organized ZIP of a video's clips: numbered parts named
// after their hook titles, a ready-to-paste caption .txt beside each clip,
// and a README describing everything.
router.get("/videos/:id/download.zip", wrap(async (req, res) => {
  const v = await q1("SELECT * FROM videos WHERE id = ?", [req.params.id]);
  if (!v) return res.status(404).json({ error: "Video not found" });
  const clips = await q("SELECT * FROM clips WHERE video_id = ? ORDER BY part_number", [v.id]);
  if (!clips.length) return res.status(400).json({ error: "No clips yet - still processing?" });

  const { ZipArchive } = await import("archiver");
  const folder = safeName(v.title);
  res.setHeader("Content-Type", "application/zip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${folder} - ${clips.length} clips.zip"`
  );

  // Videos are already compressed; store-mode keeps zipping instant.
  const archive = new ZipArchive({ store: true });
  archive.on("error", (err) => {
    console.error("[zip] archive error:", err);
    res.destroy(err);
  });
  archive.pipe(res);

  const pad = (n) => String(n).padStart(2, "0");
  const readmeLines = [
    v.title,
    "=".repeat(v.title.length),
    "",
    `Source file: ${v.original_filename}`,
    `Total length: ${Math.round(v.duration_seconds || 0)}s, split into ${clips.length} part(s)`,
    `Created: ${new Date(Number(v.created_at)).toISOString()}`,
    "",
    "Each part has:",
    "  - the clip itself (.mp4) with the PART badge, site domain and subtitles burned in",
    "  - a caption file (.txt) with the ready-to-paste title, description and hashtags",
    "",
    `Suggested posting schedule: part 1 now, each next part ${config.uploadIntervalHours} hours later.`,
    "",
    "Parts:",
  ];

  for (const c of clips) {
    const hook = c.gen_title ? ` - ${safeName(c.gen_title, 50)}` : "";
    const base = `Part ${pad(c.part_number)} of ${pad(c.total_parts)}${hook}`;
    const clipPath = path.join(config.clipsDir, c.filename);
    if (fs.existsSync(clipPath)) {
      archive.file(clipPath, { name: `${folder}/${base}.mp4` });
    }

    const { title, caption } = textsFor(v, c);
    const hashtags = JSON.parse(c.gen_hashtags || "[]").join(" ");
    const captionText = [
      `PART ${c.part_number} OF ${c.total_parts}  (${Math.round(c.duration_seconds || 0)}s)`,
      "",
      "TITLE (YouTube):",
      title,
      "",
      "CAPTION (TikTok / Instagram / Facebook):",
      caption,
      "",
      "X POST (280-char limit applied):",
      caption.length > 275 ? `${caption.slice(0, 272).trimEnd()}…` : caption,
      hashtags ? `\nHASHTAGS:\n${hashtags}` : "",
      "",
    ].join("\n");
    archive.append(captionText, { name: `${folder}/${base} - caption.txt` });

    readmeLines.push(
      `  ${pad(c.part_number)}. ${c.gen_title || `${v.title} - Part ${c.part_number}`} (${Math.round(c.duration_seconds || 0)}s)`
    );
  }

  archive.append(readmeLines.join("\n") + "\n", { name: `${folder}/README.txt` });
  await archive.finalize();
}));

router.get("/stats", wrap(async (req, res) => {
  const now = Date.now();
  const count = async (sql, params = []) => Number((await q1(sql, params)).n);

  const nextPublishes = await q(
    `SELECT clips.id, clips.part_number, clips.total_parts, clips.scheduled_at,
            clips.gen_title, videos.id AS video_id, videos.title
     FROM clips JOIN videos ON videos.id = clips.video_id
     WHERE videos.status = 'ready' AND videos.publish_mode = 'auto' AND clips.scheduled_at > ?
     ORDER BY clips.scheduled_at ASC LIMIT 6`,
    [now]
  );

  const recentUploads = (await q(
    `SELECT uploads.platform, uploads.status, uploads.error, uploads.uploaded_at,
            uploads.platform_video_id, uploads.public_post_id, accounts.display_name AS account_name,
            clips.part_number, clips.total_parts, videos.id AS video_id, videos.title
     FROM uploads
     LEFT JOIN accounts ON accounts.id = uploads.account_id
     JOIN clips ON clips.id = uploads.clip_id
     JOIN videos ON videos.id = clips.video_id
     ORDER BY COALESCE(uploads.uploaded_at, 0) DESC, uploads.id DESC LIMIT 8`
  )).map((u) => ({ ...u, url: u.status === "done" ? postUrl(u) : null }));

  const metricRows = await q(
    "SELECT metrics_json FROM uploads WHERE status = 'done' AND metrics_json IS NOT NULL"
  );
  const totalViews = metricRows.reduce(
    (sum, r) => sum + Number(JSON.parse(r.metrics_json).views || 0), 0
  );

  const accountsByPlatform = Object.fromEntries(
    (await q("SELECT platform, COUNT(*) AS n FROM accounts GROUP BY platform"))
      .map((r) => [r.platform, Number(r.n)])
  );

  res.json({
    totals: {
      totalViews,
      videos: await count("SELECT COUNT(*) AS n FROM videos"),
      clips: await count("SELECT COUNT(*) AS n FROM clips"),
      published: await count("SELECT COUNT(*) AS n FROM uploads WHERE status = 'done'"),
      failedUploads: await count(
        "SELECT COUNT(*) AS n FROM uploads WHERE status = 'failed' AND next_attempt_at IS NULL"
      ),
      scheduled: await count(
        `SELECT COUNT(*) AS n FROM clips JOIN videos ON videos.id = clips.video_id
         WHERE videos.status = 'ready' AND videos.publish_mode = 'auto' AND clips.scheduled_at > ?`,
        [now]
      ),
      accounts: await count("SELECT COUNT(*) AS n FROM accounts"),
      processingVideos: await count("SELECT COUNT(*) AS n FROM videos WHERE status = 'processing'"),
      failedVideos: await count("SELECT COUNT(*) AS n FROM videos WHERE status = 'failed'"),
    },
    queueDepth: queueLength(),
    accountsByPlatform,
    nextPublishes: nextPublishes.map((c) => ({ ...c, scheduled_at: Number(c.scheduled_at) })),
    recentUploads: recentUploads.map((u) => ({
      ...u,
      uploaded_at: u.uploaded_at ? Number(u.uploaded_at) : null,
    })),
  });
}));

// Full per-account picture: every planned post with its (fore)casted time,
// plus everything already posted, per connected account.
router.get("/schedule/accounts", wrap(async (req, res) => {
  const now = Date.now();
  const accounts = await q("SELECT * FROM accounts ORDER BY platform ASC, display_name ASC");
  const result = [];

  for (const a of accounts) {
    const gapMs = Number(a.min_gap_hours || 0) * 3600 * 1000;

    // Clips still owed to this account: assigned video, not successfully
    // posted here yet; failed posts with a pending retry count as upcoming.
    const pending = await q(
      `SELECT clips.id, clips.part_number, clips.total_parts, clips.scheduled_at,
              clips.gen_title, videos.id AS video_id, videos.title,
              u.status AS upload_status, u.next_attempt_at
       FROM clips
       JOIN videos ON videos.id = clips.video_id
       JOIN video_accounts va ON va.video_id = videos.id AND va.account_id = ?
       LEFT JOIN uploads u ON u.clip_id = clips.id AND u.account_id = ?
       WHERE videos.status = 'ready' AND videos.publish_mode = 'auto'
         AND (u.id IS NULL OR (u.status = 'failed' AND u.next_attempt_at IS NOT NULL))
       ORDER BY videos.created_at ASC, clips.part_number ASC`,
      [a.id, a.id]
    );

    const shape = (c, plannedAt, estimated) => ({
      clipId: c.id,
      videoId: c.video_id,
      videoTitle: c.title,
      genTitle: c.gen_title,
      part: c.part_number,
      totalParts: c.total_parts,
      plannedAt,
      estimated,
      retry: c.upload_status === "failed",
    });

    let upcoming;
    if (gapMs > 0) {
      // Cadence account: forecast sequential slots from its last post.
      const last = await q1(
        "SELECT MAX(uploaded_at) AS t FROM uploads WHERE account_id = ? AND status = 'done'",
        [a.id]
      );
      let cursor = Math.max(now, Number(last?.t || 0) + gapMs);
      upcoming = pending.map((c) => {
        const planned = Math.max(cursor, Number(c.next_attempt_at || 0));
        cursor = planned + gapMs;
        return shape(c, planned, true);
      });
    } else {
      // Default schedule: the clip's own timeline slot (or its retry time).
      upcoming = pending.map((c) =>
        shape(c, Math.max(Number(c.scheduled_at), Number(c.next_attempt_at || 0)), false));
    }

    const posted = (await q(
      `SELECT uploads.id AS upload_id, uploads.status, uploads.error, uploads.uploaded_at,
              uploads.attempts, uploads.platform, uploads.platform_video_id, uploads.public_post_id,
              clips.part_number AS part, clips.total_parts, clips.gen_title,
              videos.id AS video_id, videos.title AS video_title
       FROM uploads
       JOIN clips ON clips.id = uploads.clip_id
       JOIN videos ON videos.id = clips.video_id
       WHERE uploads.account_id = ? AND uploads.status IN ('done', 'failed', 'skipped')
       ORDER BY COALESCE(uploads.uploaded_at, 0) DESC, uploads.id DESC LIMIT 60`,
      [a.id]
    )).map((u) => ({
      ...u,
      uploaded_at: u.uploaded_at ? Number(u.uploaded_at) : null,
      url: u.status === "done" ? postUrl({ ...u, account_name: a.display_name }) : null,
    }));

    result.push({
      id: a.id,
      platform: a.platform,
      name: a.display_name,
      minGapHours: Number(a.min_gap_hours || 0),
      upcoming,
      posted,
    });
  }

  res.json({ now, accounts: result });
}));

router.get("/schedule", wrap(async (req, res) => {
  const clips = await q(
    `SELECT clips.id, clips.part_number, clips.total_parts, clips.scheduled_at,
            clips.gen_title, clips.filename, videos.id AS video_id, videos.title
     FROM clips JOIN videos ON videos.id = clips.video_id
     WHERE videos.status = 'ready' AND videos.publish_mode = 'auto'
     ORDER BY clips.scheduled_at ASC LIMIT 200`
  );
  const upcoming = [];
  for (const c of clips) {
    upcoming.push({
      ...c,
      scheduled_at: Number(c.scheduled_at),
      uploads: await q(
        `SELECT uploads.platform, uploads.status, accounts.display_name AS account_name
         FROM uploads LEFT JOIN accounts ON accounts.id = uploads.account_id
         WHERE uploads.clip_id = ?`,
        [c.id]
      ),
    });
  }

  const history = (await q(
    `SELECT uploads.id AS upload_id, uploads.platform, uploads.status, uploads.error, uploads.uploaded_at,
            uploads.attempts, uploads.platform_video_id, uploads.public_post_id,
            accounts.display_name AS account_name,
            clips.part_number, clips.total_parts, videos.id AS video_id, videos.title
     FROM uploads
     LEFT JOIN accounts ON accounts.id = uploads.account_id
     JOIN clips ON clips.id = uploads.clip_id
     JOIN videos ON videos.id = clips.video_id
     WHERE uploads.status IN ('done', 'failed')
     ORDER BY COALESCE(uploads.uploaded_at, 0) DESC, uploads.id DESC LIMIT 100`
  )).map((u) => ({
    ...u,
    uploaded_at: u.uploaded_at ? Number(u.uploaded_at) : null,
    url: u.status === "done" ? postUrl(u) : null,
  }));

  res.json({ upcoming, history });
}));

const EMPTY = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
const addInto = (target, m) => {
  for (const key of Object.keys(EMPTY)) target[key] += Number(m?.[key] || 0);
};

router.get("/analytics", wrap(async (req, res) => {
  const rows = await q(
    `SELECT uploads.id, uploads.platform, uploads.metrics_json, uploads.metrics_at,
            uploads.uploaded_at, uploads.platform_video_id, uploads.public_post_id,
            accounts.id AS account_id, accounts.display_name AS account_name,
            clips.part_number, clips.total_parts, clips.gen_title,
            videos.id AS video_id, videos.title AS video_title
     FROM uploads
     JOIN accounts ON accounts.id = uploads.account_id
     JOIN clips ON clips.id = uploads.clip_id
     JOIN videos ON videos.id = clips.video_id
     WHERE uploads.status = 'done'
     ORDER BY COALESCE(uploads.uploaded_at, 0) DESC`
  );

  const totals = { ...EMPTY, posts: rows.length, withMetrics: 0 };
  const accounts = new Map();
  const videos = new Map();
  let lastFetched = null;

  for (const row of rows) {
    const metrics = row.metrics_json ? JSON.parse(row.metrics_json) : null;
    if (metrics) {
      totals.withMetrics++;
      addInto(totals, metrics);
      lastFetched = Math.max(lastFetched || 0, Number(row.metrics_at) || 0);
    }

    if (!accounts.has(row.account_id)) {
      accounts.set(row.account_id, {
        accountId: row.account_id, platform: row.platform,
        accountName: row.account_name, posts: 0, withMetrics: 0, lastAt: null, ...EMPTY,
      });
    }
    const acc = accounts.get(row.account_id);
    acc.posts++;
    if (metrics) {
      acc.withMetrics++;
      acc.lastAt = Math.max(acc.lastAt || 0, Number(row.metrics_at) || 0) || acc.lastAt;
    }
    addInto(acc, metrics);

    if (!videos.has(row.video_id)) {
      videos.set(row.video_id, {
        videoId: row.video_id, title: row.video_title, posts: 0, withMetrics: 0, ...EMPTY, uploads: [],
      });
    }
    const vid = videos.get(row.video_id);
    vid.posts++;
    if (metrics) vid.withMetrics++;
    addInto(vid, metrics);
    vid.uploads.push({
      platform: row.platform,
      accountName: row.account_name,
      part: row.part_number,
      totalParts: row.total_parts,
      genTitle: row.gen_title,
      url: postUrl(row),
      uploadedAt: row.uploaded_at ? Number(row.uploaded_at) : null,
      metrics,
    });
  }

  res.json({
    totals,
    lastFetched,
    status: metricsStatus(),
    accounts: [...accounts.values()].sort((a, b) => b.views - a.views),
    videos: [...videos.values()].sort((a, b) => b.views - a.views),
  });
}));

// Re-queue every failed post (e.g. after fixing a platform-side issue such
// as depleted X credits or a blocked Meta app). Exhausted failures are
// deleted so the scheduler re-attempts from scratch; ones still on a retry
// timer become due immediately.
// Retry a single failed post (or bring a skipped one back into the queue):
// reset its attempts and make it due now.
router.post("/uploads/:id/retry", wrap(async (req, res) => {
  const u = await q1("SELECT * FROM uploads WHERE id = ?", [req.params.id]);
  if (!u) return res.status(404).json({ error: "Post not found" });
  if (u.status !== "failed" && u.status !== "skipped") {
    return res.status(400).json({ error: "Only failed or skipped posts can be retried" });
  }
  await dbRun(
    "UPDATE uploads SET status = 'failed', attempts = 0, next_attempt_at = ? WHERE id = ?",
    [Date.now(), u.id]
  );
  res.json({ ok: true });
}));

// Drop one queued post from one account's line: it never publishes there,
// and everything behind it moves up. Undo via the retry endpoint.
router.post("/clips/:clipId/skip", wrap(async (req, res) => {
  const clip = await q1("SELECT * FROM clips WHERE id = ?", [req.params.clipId]);
  if (!clip) return res.status(404).json({ error: "Clip not found" });
  const account = await q1("SELECT * FROM accounts WHERE id = ?", [req.body.accountId]);
  if (!account) return res.status(404).json({ error: "Account not found" });
  const existing = await q1(
    "SELECT * FROM uploads WHERE clip_id = ? AND account_id = ?",
    [clip.id, account.id]
  );
  if (existing?.status === "done") {
    return res.status(400).json({ error: "Already posted - nothing to skip" });
  }
  await dbRun(
    `INSERT INTO uploads (clip_id, account_id, platform, status, attempts, next_attempt_at, error)
     VALUES (?, ?, ?, 'skipped', 0, NULL, NULL)
     ON CONFLICT (clip_id, account_id) DO UPDATE SET
       status = 'skipped', next_attempt_at = NULL, error = NULL`,
    [clip.id, account.id, account.platform]
  );
  res.json({ ok: true });
}));

router.post("/uploads/retry-failed", wrap(async (req, res) => {
  const n = Number((await q1("SELECT COUNT(*) AS n FROM uploads WHERE status = 'failed'")).n);
  await dbRun("DELETE FROM uploads WHERE status = 'failed' AND next_attempt_at IS NULL");
  await dbRun("UPDATE uploads SET next_attempt_at = ? WHERE status = 'failed'", [Date.now()]);
  res.json({ retried: n });
}));

router.post("/metrics/refresh", wrap(async (req, res) => {
  // Fire and forget; the analytics endpoint reflects progress.
  refreshMetrics().catch((err) => console.error("[metrics] manual refresh:", err));
  res.json({ ok: true });
}));

// Re-scan the connected Facebook login for Pages created after connecting.
router.post("/facebook/sync-pages", wrap(async (req, res) => {
  res.json(await syncFacebookPages());
}));

router.get("/settings", wrap(async (req, res) => {
  res.json({
    branding: {
      siteDomain: config.siteDomain,
      clipDurationSeconds: config.clipDurationSeconds,
      uploadIntervalHours: config.uploadIntervalHours,
      verticalFormat: config.verticalFormat,
    },
    quality: {
      videoCrf: config.videoCrf,
      videoPreset: config.videoPreset,
      normalizeAudio: config.normalizeAudio,
    },
    ai: {
      openaiKeySet: Boolean(config.openaiApiKey),
      subtitlesEnabled: subtitlesEnabled(),
      metadataEnabled: metadataEnabled(),
      chatModel: config.openaiChatModel,
    },
    accounts: {
      maxPerPlatform: config.maxAccountsPerPlatform,
    },
    cleanup: {
      deleteOriginalsAfterDays: config.deleteOriginalsAfterDays,
      pruneVideosAfterDays: config.pruneVideosAfterDays,
    },
    server: {
      baseUrl: config.baseUrl,
      port: config.port,
      authEnabled: authEnabled(),
      database: dbKind === "postgres" ? "Postgres (DATABASE_URL)" : "SQLite (data/app.db)",
      uptimeSeconds: Math.round(process.uptime()),
      queueDepth: queueLength(),
      nodeVersion: process.version,
      redirectUris: Object.fromEntries(
        PLATFORM_KEYS.map((k) => [k, `${config.baseUrl}/auth/${k}/callback`])
      ),
      credentialsConfigured: Object.fromEntries(
        PLATFORM_KEYS.map((k) => [k, platforms[k].isConfigured()])
      ),
      metaWebhook: {
        callbackUrl: `${config.baseUrl}/webhooks/meta`,
        verifyToken: config.metaVerifyToken,
      },
    },
  });
}));

export default router;
