import config from "./config.js";

// Async database adapter with two drivers:
//   - SQLite (default): zero-config, stored in data/app.db.
//   - Postgres (Neon or any other): set DATABASE_URL.
// All queries use ?-placeholders; they're translated to $n for Postgres.
//
//   q(sql, params)   -> all rows
//   q1(sql, params)  -> first row or undefined
//   run(sql, params) -> { changes } (use q1 with RETURNING for insert ids)

export let dbKind = "sqlite";

let _q, _q1, _run, _close;

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

const PG_SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  platform TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at BIGINT,
  external_id TEXT,
  display_name TEXT,
  connected_at BIGINT NOT NULL,
  min_gap_hours DOUBLE PRECISION NOT NULL DEFAULT 0,
  UNIQUE (platform, external_id)
);
CREATE TABLE IF NOT EXISTS videos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  original_filename TEXT NOT NULL,
  path TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION,
  status TEXT NOT NULL DEFAULT 'processing',
  error TEXT,
  cuts_json TEXT,
  publish_mode TEXT NOT NULL DEFAULT 'manual',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS clips (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  part_number INTEGER NOT NULL,
  total_parts INTEGER NOT NULL,
  filename TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION,
  scheduled_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  gen_title TEXT,
  gen_description TEXT,
  gen_hashtags TEXT
);
CREATE TABLE IF NOT EXISTS video_accounts (
  video_id BIGINT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  assigned_at BIGINT NOT NULL,
  UNIQUE (video_id, platform)
);
CREATE TABLE IF NOT EXISTS uploads (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  clip_id BIGINT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at BIGINT,
  platform_video_id TEXT,
  error TEXT,
  uploaded_at BIGINT,
  metrics_json TEXT,
  metrics_at BIGINT,
  public_post_id TEXT,
  UNIQUE (clip_id, account_id)
);
CREATE TABLE IF NOT EXISTS users (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ugc_jobs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_url TEXT NOT NULL,
  product_json TEXT,
  settings_json TEXT,
  script_json TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  provider TEXT,
  video_filename TEXT,
  auto_post INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS ugc_posts (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES ugc_jobs(id) ON DELETE CASCADE,
  account_id BIGINT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  platform_video_id TEXT,
  public_post_id TEXT,
  posted_at BIGINT,
  UNIQUE (job_id, account_id)
);
`;

if (config.databaseUrl) {
  dbKind = "postgres";
  const { default: pg } = await import("pg");
  // BIGINT (ids, epoch-ms timestamps) comes back as strings by default;
  // our values all fit safely in JS numbers.
  pg.types.setTypeParser(20, (v) => Number(v));
  const needsSsl = !/localhost|127\.0\.0\.1/.test(config.databaseUrl);
  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  pool.on("error", (err) => console.error("[db] postgres pool error:", err.message));

  _q = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows;
  _q1 = async (sql, params = []) => (await pool.query(toPg(sql), params)).rows[0];
  _run = async (sql, params = []) => {
    const result = await pool.query(toPg(sql), params);
    return { changes: result.rowCount };
  };
  _close = () => pool.end();

  await pool.query(PG_SCHEMA);
  // Upgrades for Postgres databases created by earlier versions.
  await pool.query(
    "ALTER TABLE videos ADD COLUMN IF NOT EXISTS publish_mode TEXT NOT NULL DEFAULT 'manual'"
  );
  await pool.query(
    "ALTER TABLE accounts ADD COLUMN IF NOT EXISTS min_gap_hours DOUBLE PRECISION NOT NULL DEFAULT 0"
  );
  console.log("[db] connected to Postgres");
} else {
  const { default: Database } = await import("better-sqlite3");
  const sdb = new Database(config.dbPath);
  sdb.pragma("journal_mode = WAL");
  sdb.pragma("foreign_keys = ON");
  initSqlite(sdb);

  _q = async (sql, params = []) => sdb.prepare(sql).all(...params);
  _q1 = async (sql, params = []) => sdb.prepare(sql).get(...params);
  _run = async (sql, params = []) => {
    const info = sdb.prepare(sql).run(...params);
    return { changes: info.changes };
  };
  _close = () => sdb.close();
}

export const q = (sql, params) => _q(sql, params);
export const q1 = (sql, params) => _q1(sql, params);
export const run = (sql, params) => _run(sql, params);
export const closeDb = () => _close();

/* ---------- SQLite schema + legacy migrations (pragma user_version) ---------- */

function initSqlite(db) {
  const version = db.pragma("user_version", { simple: true });

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
  platform TEXT NOT NULL,
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  expires_at INTEGER,
  external_id TEXT,
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
  status TEXT NOT NULL DEFAULT 'processing',
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
  scheduled_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
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
  status TEXT NOT NULL DEFAULT 'pending',
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

  if (version < 2) {
    const cols = db.prepare("PRAGMA table_info(videos)").all();
    if (!cols.some((c) => c.name === "cuts_json")) {
      db.exec("ALTER TABLE videos ADD COLUMN cuts_json TEXT");
    }
    db.pragma("user_version = 2");
  }

  if (version < 3) {
    const cols = db.prepare("PRAGMA table_info(clips)").all();
    for (const col of ["gen_title", "gen_description", "gen_hashtags"]) {
      if (!cols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE clips ADD COLUMN ${col} TEXT`);
      }
    }
    db.pragma("user_version = 3");
  }

  if (version < 4) {
    const cols = db.prepare("PRAGMA table_info(uploads)").all();
    for (const [col, type] of [
      ["metrics_json", "TEXT"],
      ["metrics_at", "INTEGER"],
      ["public_post_id", "TEXT"],
    ]) {
      if (!cols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE uploads ADD COLUMN ${col} ${type}`);
      }
    }
    db.pragma("user_version = 4");
  }

  // v4 -> v5: per-video publish mode (manual download vs auto-publish).
  if (version < 5) {
    const cols = db.prepare("PRAGMA table_info(videos)").all();
    if (!cols.some((c) => c.name === "publish_mode")) {
      db.exec("ALTER TABLE videos ADD COLUMN publish_mode TEXT NOT NULL DEFAULT 'manual'");
    }
    db.pragma("user_version = 5");
  }

  // v5 -> v6: per-account minimum gap between posts.
  if (version < 6) {
    const cols = db.prepare("PRAGMA table_info(accounts)").all();
    if (!cols.some((c) => c.name === "min_gap_hours")) {
      db.exec("ALTER TABLE accounts ADD COLUMN min_gap_hours REAL NOT NULL DEFAULT 0");
    }
    db.pragma("user_version = 6");
  }

  // v6 -> v7: user accounts (email+password sign-in and public signups).
  if (version < 7) {
    db.exec(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at INTEGER NOT NULL
    )`);
    db.pragma("user_version = 7");
  }

  // v7 -> v8: UGC studio (product URL -> generated video -> auto-post).
  if (version < 8) {
    db.exec(`CREATE TABLE IF NOT EXISTS ugc_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_url TEXT NOT NULL,
      product_json TEXT,
      settings_json TEXT,
      script_json TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      provider TEXT,
      video_filename TEXT,
      auto_post INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS ugc_posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL REFERENCES ugc_jobs(id) ON DELETE CASCADE,
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      platform_video_id TEXT,
      public_post_id TEXT,
      posted_at INTEGER,
      UNIQUE (job_id, account_id)
    )`);
    db.pragma("user_version = 8");
  }
}
