import Database from "better-sqlite3";
import config from "./config.js";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL UNIQUE,          -- youtube | instagram | tiktok
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,                     -- epoch ms when access_token expires
  external_id TEXT,                       -- channel/user id on the platform
  display_name TEXT,
  connected_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS videos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  path TEXT NOT NULL,
  duration_seconds REAL,
  status TEXT NOT NULL DEFAULT 'processing',  -- processing | ready | failed
  error TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  total_parts INTEGER NOT NULL,
  filename TEXT NOT NULL,
  duration_seconds REAL,
  scheduled_at INTEGER NOT NULL,          -- epoch ms when this clip should publish
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | uploading | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  platform_video_id TEXT,
  error TEXT,
  uploaded_at INTEGER,
  UNIQUE (clip_id, platform)
);
`);

export default db;
