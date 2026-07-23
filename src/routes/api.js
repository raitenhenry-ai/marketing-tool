import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import config from "../config.js";
import db from "../db.js";
import { processVideo } from "../processing.js";
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
  const connected = Object.fromEntries(
    db.prepare("SELECT platform, display_name, connected_at FROM accounts").all()
      .map((a) => [a.platform, { displayName: a.display_name, connectedAt: a.connected_at }])
  );
  res.json({
    platforms: {
      youtube: { configured: youtube.isConfigured(), account: connected.youtube || null },
      instagram: { configured: instagram.isConfigured(), account: connected.instagram || null },
      tiktok: { configured: tiktok.isConfigured(), account: connected.tiktok || null },
    },
    settings: {
      siteDomain: config.siteDomain,
      clipDurationSeconds: config.clipDurationSeconds,
      uploadIntervalHours: config.uploadIntervalHours,
    },
  });
});

router.post("/videos", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No video file received" });
  const title = (req.body.title || "").trim() || path.parse(req.file.originalname || "video").name;

  const result = db.prepare(
    `INSERT INTO videos (title, original_filename, path, status, created_at)
     VALUES (?, ?, ?, 'processing', ?)`
  ).run(title, req.file.originalname || req.file.filename, req.file.path, Date.now());

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
    "SELECT platform, status, attempts, error, platform_video_id, uploaded_at FROM uploads WHERE clip_id = ?"
  );

  res.json(
    videos.map((v) => ({
      id: v.id,
      title: v.title,
      status: v.status,
      error: v.error,
      durationSeconds: v.duration_seconds,
      createdAt: v.created_at,
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
