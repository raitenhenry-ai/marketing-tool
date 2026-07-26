import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Credentials pasted into env panels often pick up trailing whitespace or
// newlines, which platforms reject as "incorrect secret". Always trim.
const env = (name, fallback = "") => (process.env[name] ?? fallback).trim();

function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  baseUrl: env("BASE_URL", `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ""),

  siteDomain: process.env.SITE_DOMAIN || "www.clint.build",
  clipDurationSeconds: Number(process.env.CLIP_DURATION_SECONDS || 120),
  uploadIntervalHours: Number(process.env.UPLOAD_INTERVAL_HOURS || 3),
  maxAccountsPerPlatform: Number(process.env.MAX_ACCOUNTS_PER_PLATFORM || 5),

  // Dashboard login; empty = no auth (local use only).
  adminPassword: env("ADMIN_PASSWORD"),
  // Days before original uploads / whole videos are cleaned from disk.
  deleteOriginalsAfterDays: Number(process.env.DELETE_ORIGINALS_AFTER_DAYS ?? 7),
  pruneVideosAfterDays: Number(process.env.PRUNE_VIDEOS_AFTER_DAYS ?? 0),
  verticalFormat: (process.env.VERTICAL_FORMAT || "true").toLowerCase() !== "false",

  // Encoding speed/quality. veryfast + CRF 20 is the sweet spot for shared
  // vCPUs: the platforms re-encode uploads anyway, so the last few percent
  // of source quality (slower presets, lower CRF) rarely survives to viewers.
  videoCrf: Number(process.env.VIDEO_CRF || 20),
  videoPreset: process.env.VIDEO_PRESET || "superfast",
  normalizeAudio: (process.env.NORMALIZE_AUDIO || "true").toLowerCase() !== "false",
  // Vertical canvas height: 1920 (1080p) or 1280 (720p, ~2x faster encode).
  verticalHeight: Number(process.env.VERTICAL_HEIGHT || 1920),

  // Auto-subtitles via OpenAI Whisper; disabled when no API key is set.
  openaiApiKey: env("OPENAI_API_KEY"),
  subtitles: (process.env.SUBTITLES || "true").toLowerCase() !== "false",
  // Per-clip AI titles/descriptions/hashtags from the transcript.
  generateMetadata: (process.env.GENERATE_METADATA || "true").toLowerCase() !== "false",
  openaiChatModel: process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini",

  // Postgres/Neon connection string; empty = local SQLite in data/app.db.
  databaseUrl: env("DATABASE_URL"),

  dataDir: path.join(rootDir, "data"),
  uploadsDir: path.join(rootDir, "data", "uploads"),
  clipsDir: path.join(rootDir, "data", "clips"),
  dbPath: path.join(rootDir, "data", "app.db"),

  ffmpegPath: process.env.FFMPEG_PATH || "ffmpeg",
  ffprobePath: process.env.FFPROBE_PATH || "ffprobe",
  fontPath: firstExisting([
    process.env.FONT_PATH,
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:\\Windows\\Fonts\\arialbd.ttf",
  ]),

  youtube: {
    clientId: env("YOUTUBE_CLIENT_ID"),
    clientSecret: env("YOUTUBE_CLIENT_SECRET"),
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || "public",
  },
  instagram: {
    clientId: env("INSTAGRAM_CLIENT_ID"),
    clientSecret: env("INSTAGRAM_CLIENT_SECRET"),
  },
  tiktok: {
    clientKey: env("TIKTOK_CLIENT_KEY"),
    clientSecret: env("TIKTOK_CLIENT_SECRET"),
    privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
    // Must match the scopes approved for your TikTok app. video.list powers
    // the Analytics metrics; drop it if your app doesn't have that scope.
    scopes: env("TIKTOK_SCOPES", "user.info.basic,video.publish,video.list"),
  },
  facebook: {
    appId: env("FACEBOOK_APP_ID"),
    appSecret: env("FACEBOOK_APP_SECRET"),
  },
  x: {
    clientId: env("X_CLIENT_ID"),
    clientSecret: env("X_CLIENT_SECRET"),
  },
};

try {
  for (const dir of [config.dataDir, config.uploadsDir, config.clipsDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
} catch (err) {
  console.error(
    `\nFATAL: cannot create the data directory (${err.code}: ${err.message}).\n\n` +
      "If you are seeing this on Vercel, Netlify or another serverless platform:\n" +
      "this app CANNOT run there. It needs a persistent server with a writable\n" +
      "disk, ffmpeg, and an always-on background scheduler. Deploy the included\n" +
      "Dockerfile to Railway, Render, Fly.io or a VPS instead - see README.md.\n"
  );
  process.exit(1);
}

export default config;
