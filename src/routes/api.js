import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import config from "../config.js";
import db from "../db.js";
import fs from "node:fs";
import { enqueueProcessing, queueLength } from "../processing.js";
import { subtitlesEnabled } from "../transcribe.js";
import { metadataEnabled } from "../metadata.js";
import { parseCuts } from "../cuts.js";
import { deleteVideoFiles } from "../cleanup.js";
import { authEnabled } from "../auth.js";
import { refreshMetrics, metricsStatus } from "../metrics.js";
import { platforms } from "../scheduler.js";

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

router.get("/accounts", (req, res) => {
  const byPlatform = Object.fromEntries(PLATFORM_KEYS.map((k) => [k, []]));
  for (const a of db.prepare(
    `SELECT accounts.id, accounts.platform, accounts.display_name, accounts.connected_at,
            COUNT(video_accounts.video_id) AS videos_assigned
     FROM accounts LEFT JOIN video_accounts ON video_accounts.account_id = accounts.id
     GROUP BY accounts.id ORDER BY accounts.id`
  ).all()) {
    byPlatform[a.platform]?.push({
      id: a.id,
      displayName: a.display_name,
      connectedAt: a.connected_at,
      videosAssigned: a.videos_assigned,
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
});

router.post("/videos", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file received" });
  const title = (req.body.title || "").trim() || path.parse(req.file.originalname || "video").name;

  let cuts = null;
  try {
    cuts = parseCuts(req.body.cuts);
  } catch (err) {
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({ error: String(err.message || err) });
  }

  const result = db.prepare(
    `INSERT INTO videos (title, original_filename, path, status, cuts_json, created_at)
     VALUES (?, ?, ?, 'processing', ?, ?)`
  ).run(
    title,
    req.file.originalname || req.file.filename,
    req.file.path,
    cuts ? JSON.stringify(cuts) : null,
    Date.now()
  );

  // Queued (one encode at a time) - progress is visible via GET /api/videos.
  enqueueProcessing(result.lastInsertRowid);

  res.json({ id: result.lastInsertRowid, status: "processing" });
});

router.post("/videos/:id/reprocess", (req, res) => {
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(req.params.id);
  if (!video) return res.status(404).json({ error: "Video not found" });
  if (video.status !== "failed") {
    return res.status(400).json({ error: "Only failed videos can be reprocessed" });
  }
  db.prepare("UPDATE videos SET status = 'processing', error = NULL WHERE id = ?").run(video.id);
  enqueueProcessing(video.id);
  res.json({ ok: true });
});

router.get("/videos", (req, res) => {
  const videos = db.prepare("SELECT * FROM videos ORDER BY created_at DESC").all();
  const clipsStmt = db.prepare(
    `SELECT id, part_number, total_parts, filename, duration_seconds, scheduled_at,
            gen_title, gen_hashtags
     FROM clips WHERE video_id = ? ORDER BY part_number`
  );
  const uploadsStmt = db.prepare(
    `SELECT uploads.platform, uploads.status, uploads.attempts, uploads.error,
            uploads.platform_video_id, uploads.uploaded_at, accounts.display_name AS account_name
     FROM uploads LEFT JOIN accounts ON accounts.id = uploads.account_id
     WHERE uploads.clip_id = ?`
  );
  const assignmentsStmt = db.prepare(
    `SELECT video_accounts.platform, accounts.display_name AS account_name
     FROM video_accounts JOIN accounts ON accounts.id = video_accounts.account_id
     WHERE video_accounts.video_id = ?`
  );

  res.json(
    videos.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      error: v.error,
      durationSeconds: v.duration_seconds,
      createdAt: v.created_at,
      accounts: assignmentsStmt.all(v.id),
      clips: clipsStmt.all(v.id).map((c) => ({
        id: c.id,
        part: c.part_number,
        totalParts: c.total_parts,
        durationSeconds: c.duration_seconds,
        scheduledAt: c.scheduled_at,
        genTitle: c.gen_title,
        genHashtags: JSON.parse(c.gen_hashtags || "[]"),
        url: `/clips/${encodeURIComponent(c.filename)}`,
        uploads: uploadsStmt.all(c.id),
      })),
    }))
  );
});

router.delete("/videos/:id", (req, res) => {
  const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(req.params.id);
  if (!video) return res.status(404).json({ error: "Video not found" });
  deleteVideoFiles(video);
  db.prepare("DELETE FROM videos WHERE id = ?").run(video.id);
  res.json({ ok: true });
});

router.get("/videos/:id", (req, res) => {
  const v = db.prepare("SELECT * FROM videos WHERE id = ?").get(req.params.id);
  if (!v) return res.status(404).json({ error: "Video not found" });

  const clips = db.prepare(
    "SELECT * FROM clips WHERE video_id = ? ORDER BY part_number"
  ).all(v.id);
  const uploadsStmt = db.prepare(
    `SELECT uploads.*, accounts.display_name AS account_name
     FROM uploads LEFT JOIN accounts ON accounts.id = uploads.account_id
     WHERE uploads.clip_id = ?`
  );
  const assignments = db.prepare(
    `SELECT video_accounts.platform, accounts.display_name AS account_name, accounts.id AS account_id
     FROM video_accounts JOIN accounts ON accounts.id = video_accounts.account_id
     WHERE video_accounts.video_id = ?`
  ).all(v.id);

  res.json({
    id: v.id,
    title: v.title,
    originalFilename: v.original_filename,
    status: v.status,
    error: v.error,
    durationSeconds: v.duration_seconds,
    createdAt: v.created_at,
    cuts: v.cuts_json ? JSON.parse(v.cuts_json) : null,
    accounts: assignments,
    clips: clips.map((c) => ({
      id: c.id,
      part: c.part_number,
      totalParts: c.total_parts,
      durationSeconds: c.duration_seconds,
      scheduledAt: c.scheduled_at,
      genTitle: c.gen_title,
      genDescription: c.gen_description,
      genHashtags: JSON.parse(c.gen_hashtags || "[]"),
      url: `/clips/${encodeURIComponent(c.filename)}`,
      uploads: uploadsStmt.all(c.id).map((u) => ({
        platform: u.platform,
        accountName: u.account_name,
        status: u.status,
        attempts: u.attempts,
        error: u.error,
        platformVideoId: u.platform_video_id,
        uploadedAt: u.uploaded_at,
        nextAttemptAt: u.next_attempt_at,
        metrics: u.metrics_json ? JSON.parse(u.metrics_json) : null,
        metricsAt: u.metrics_at,
      })),
    })),
  });
});

router.get("/stats", (req, res) => {
  const now = Date.now();
  const count = (sql, ...args) => db.prepare(sql).get(...args).n;

  const nextPublishes = db.prepare(
    `SELECT clips.id, clips.part_number, clips.total_parts, clips.scheduled_at,
            clips.gen_title, videos.id AS video_id, videos.title
     FROM clips JOIN videos ON videos.id = clips.video_id
     WHERE videos.status = 'ready' AND clips.scheduled_at > ?
     ORDER BY clips.scheduled_at ASC LIMIT 6`
  ).all(now);

  const recentUploads = db.prepare(
    `SELECT uploads.platform, uploads.status, uploads.error, uploads.uploaded_at,
            uploads.platform_video_id, accounts.display_name AS account_name,
            clips.part_number, clips.total_parts, videos.id AS video_id, videos.title
     FROM uploads
     LEFT JOIN accounts ON accounts.id = uploads.account_id
     JOIN clips ON clips.id = uploads.clip_id
     JOIN videos ON videos.id = clips.video_id
     ORDER BY COALESCE(uploads.uploaded_at, 0) DESC, uploads.id DESC LIMIT 8`
  ).all();

  const totalViews = db.prepare(
    "SELECT metrics_json FROM uploads WHERE status = 'done' AND metrics_json IS NOT NULL"
  ).all().reduce((sum, r) => sum + Number(JSON.parse(r.metrics_json).views || 0), 0);

  res.json({
    totals: {
      totalViews,
      videos: count("SELECT COUNT(*) AS n FROM videos"),
      clips: count("SELECT COUNT(*) AS n FROM clips"),
      published: count("SELECT COUNT(*) AS n FROM uploads WHERE status = 'done'"),
      failedUploads: count(
        "SELECT COUNT(*) AS n FROM uploads WHERE status = 'failed' AND next_attempt_at IS NULL"
      ),
      scheduled: count(
        `SELECT COUNT(*) AS n FROM clips JOIN videos ON videos.id = clips.video_id
         WHERE videos.status = 'ready' AND clips.scheduled_at > ?`, now
      ),
      accounts: count("SELECT COUNT(*) AS n FROM accounts"),
      processingVideos: count("SELECT COUNT(*) AS n FROM videos WHERE status = 'processing'"),
      failedVideos: count("SELECT COUNT(*) AS n FROM videos WHERE status = 'failed'"),
    },
    queueDepth: queueLength(),
    accountsByPlatform: Object.fromEntries(
      db.prepare("SELECT platform, COUNT(*) AS n FROM accounts GROUP BY platform").all()
        .map((r) => [r.platform, r.n])
    ),
    nextPublishes,
    recentUploads,
  });
});

router.get("/schedule", (req, res) => {
  const upcoming = db.prepare(
    `SELECT clips.id, clips.part_number, clips.total_parts, clips.scheduled_at,
            clips.gen_title, clips.filename, videos.id AS video_id, videos.title
     FROM clips JOIN videos ON videos.id = clips.video_id
     WHERE videos.status = 'ready'
     ORDER BY clips.scheduled_at ASC LIMIT 200`
  ).all().map((c) => ({
    ...c,
    uploads: db.prepare(
      `SELECT uploads.platform, uploads.status, accounts.display_name AS account_name
       FROM uploads LEFT JOIN accounts ON accounts.id = uploads.account_id
       WHERE uploads.clip_id = ?`
    ).all(c.id),
  }));

  const history = db.prepare(
    `SELECT uploads.platform, uploads.status, uploads.error, uploads.uploaded_at,
            uploads.attempts, uploads.platform_video_id, accounts.display_name AS account_name,
            clips.part_number, clips.total_parts, videos.id AS video_id, videos.title
     FROM uploads
     LEFT JOIN accounts ON accounts.id = uploads.account_id
     JOIN clips ON clips.id = uploads.clip_id
     JOIN videos ON videos.id = clips.video_id
     WHERE uploads.status IN ('done', 'failed')
     ORDER BY COALESCE(uploads.uploaded_at, 0) DESC, uploads.id DESC LIMIT 100`
  ).all();

  res.json({ upcoming, history });
});

const EMPTY = { views: 0, likes: 0, comments: 0, shares: 0, saves: 0 };
const addInto = (target, m) => {
  for (const key of Object.keys(EMPTY)) target[key] += Number(m?.[key] || 0);
};

router.get("/analytics", (req, res) => {
  const rows = db.prepare(
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
     ORDER BY uploads.uploaded_at DESC`
  ).all();

  const totals = { ...EMPTY, posts: rows.length, withMetrics: 0 };
  const accounts = new Map();
  const videos = new Map();
  let lastFetched = null;

  for (const row of rows) {
    const metrics = row.metrics_json ? JSON.parse(row.metrics_json) : null;
    if (metrics) {
      totals.withMetrics++;
      addInto(totals, metrics);
      lastFetched = Math.max(lastFetched || 0, row.metrics_at || 0);
    }

    if (!accounts.has(row.account_id)) {
      accounts.set(row.account_id, {
        accountId: row.account_id, platform: row.platform,
        accountName: row.account_name, posts: 0, ...EMPTY,
      });
    }
    const acc = accounts.get(row.account_id);
    acc.posts++;
    addInto(acc, metrics);

    if (!videos.has(row.video_id)) {
      videos.set(row.video_id, {
        videoId: row.video_id, title: row.video_title, posts: 0, ...EMPTY, uploads: [],
      });
    }
    const vid = videos.get(row.video_id);
    vid.posts++;
    addInto(vid, metrics);
    vid.uploads.push({
      platform: row.platform,
      accountName: row.account_name,
      part: row.part_number,
      totalParts: row.total_parts,
      genTitle: row.gen_title,
      uploadedAt: row.uploaded_at,
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
});

router.post("/metrics/refresh", (req, res) => {
  // Fire and forget; the analytics endpoint reflects progress.
  refreshMetrics().catch((err) => console.error("[metrics] manual refresh:", err));
  res.json({ ok: true });
});

router.get("/settings", (req, res) => {
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
      uptimeSeconds: Math.round(process.uptime()),
      queueDepth: queueLength(),
      nodeVersion: process.version,
      redirectUris: Object.fromEntries(
        PLATFORM_KEYS.map((k) => [k, `${config.baseUrl}/auth/${k}/callback`])
      ),
      credentialsConfigured: Object.fromEntries(
        PLATFORM_KEYS.map((k) => [k, platforms[k].isConfigured()])
      ),
    },
  });
});

export default router;
