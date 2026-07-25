import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import config from "../config.js";
import db from "../db.js";
import fs from "node:fs";
import { processVideo } from "../processing.js";
import { subtitlesEnabled } from "../transcribe.js";
import { parseCuts } from "../cuts.js";
import * as youtube from "../platforms/youtube.js";
import * as instagram from "../platforms/instagram.js";
import * as tiktok from "../platforms/tiktok.js";

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
  const byPlatform = { youtube: [], instagram: [], tiktok: [] };
  for (const a of db.prepare(
    "SELECT id, platform, display_name, connected_at FROM accounts ORDER BY id"
  ).all()) {
    byPlatform[a.platform]?.push({
      id: a.id,
      displayName: a.display_name,
      connectedAt: a.connected_at,
    });
  }
  res.json({
    platforms: {
      youtube: { configured: youtube.isConfigured(), accounts: byPlatform.youtube },
      instagram: { configured: instagram.isConfigured(), accounts: byPlatform.instagram },
      tiktok: { configured: tiktok.isConfigured(), accounts: byPlatform.tiktok },
    },
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

  // Fire and forget - progress is visible via GET /api/videos.
  processVideo(result.lastInsertRowid);

  res.json({ id: result.lastInsertRowid, status: "processing" });
});

router.get("/videos", (req, res) => {
  const videos = db.prepare("SELECT * FROM videos ORDER BY created_at DESC").all();
  const clipsStmt = db.prepare(
    "SELECT id, part_number, total_parts, filename, duration_seconds, scheduled_at FROM clips WHERE video_id = ? ORDER BY part_number"
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
        url: `/clips/${encodeURIComponent(c.filename)}`,
        uploads: uploadsStmt.all(c.id),
      })),
    }))
  );
});

router.delete("/videos/:id", (req, res) => {
  db.prepare("DELETE FROM videos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
