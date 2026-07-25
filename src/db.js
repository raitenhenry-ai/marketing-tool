import Database from "better-sqlite3";
import config from "./config.js";

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const version = db.pragma("user_version", { simple: true });

// v0 -> v1: single account per platform -> up to N accounts per platform,
// with each video pinned to one account per platform.
if (version < 1) {
  const hasOldAccounts =
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get() &&
    !db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'video_accounts'").get();

  if (hasOldAccounts) {
    db.exec(`
      ALTER TABLE accounts RENAME TO accounts_v0;
      ALTER TABLE uploads RENAME TO uploads_v0;
    `);
  }

  db.exec(`
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,                 -- youtube | instagram | tiktok
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,                     -- epoch ms when access_token expires
  external_id TEXT,                       -- channel/user id on the platform
  display_name TEXT,
  connected_at INTEGER NOT NULL,
  UNIQUE (platform, external_id)
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

-- Which account a video publishes to on each platform. All clips of a video
-- go to the same account (one per platform).
CREATE TABLE IF NOT EXISTS video_accounts (
  video_id INTEGER NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assigned_at INTEGER NOT NULL,
  UNIQUE (video_id, platform)
);

CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  clip_id INTEGER NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | uploading | done | failed
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER,
  platform_video_id TEXT,
  error TEXT,
  uploaded_at INTEGER,
  UNIQUE (clip_id, account_id)
);
`);

  if (hasOldAccounts) {
    db.exec(`
      INSERT INTO accounts (id, platform, access_token, refresh_token, expires_at, external_id, display_name, connected_at)
        SELECT id, platform, access_token, refresh_token, expires_at, external_id, display_name, connected_at
        FROM accounts_v0;

      -- Old uploads were keyed by platform (one account per platform); pin
      -- those videos to that account so history stays consistent.
      INSERT INTO uploads (clip_id, account_id, platform, status, attempts, next_attempt_at, platform_video_id, error, uploaded_at)
        SELECT u.clip_id, a.id, u.platform, u.status, u.attempts, u.next_attempt_at, u.platform_video_id, u.error, u.uploaded_at
        FROM uploads_v0 u JOIN accounts_v0 a ON a.platform = u.platform;

      INSERT OR IGNORE INTO video_accounts (video_id, platform, account_id, assigned_at)
        SELECT DISTINCT c.video_id, u.platform, a.id, COALESCE(u.uploaded_at, c.created_at)
        FROM uploads_v0 u
        JOIN clips c ON c.id = u.clip_id
        JOIN accounts_v0 a ON a.platform = u.platform;

      DROP TABLE uploads_v0;
      DROP TABLE accounts_v0;
    `);
  }

  db.pragma("user_version = 1");
}

export default db;
