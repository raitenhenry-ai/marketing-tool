import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function firstExisting(candidates) {
  for (const p of candidates) {
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}

const config = {
  rootDir,
  port: Number(process.env.PORT || 3000),
  baseUrl: (process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/+$/, ""),

  siteDomain: process.env.SITE_DOMAIN || "www.clint.build",
  clipDurationSeconds: Number(process.env.CLIP_DURATION_SECONDS || 120),
  uploadIntervalHours: Number(process.env.UPLOAD_INTERVAL_HOURS || 3),
  maxAccountsPerPlatform: Number(process.env.MAX_ACCOUNTS_PER_PLATFORM || 5),
  verticalFormat: (process.env.VERTICAL_FORMAT || "true").toLowerCase() !== "false",

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
    clientId: process.env.YOUTUBE_CLIENT_ID || "",
    clientSecret: process.env.YOUTUBE_CLIENT_SECRET || "",
    privacyStatus: process.env.YOUTUBE_PRIVACY_STATUS || "public",
  },
  instagram: {
    clientId: process.env.INSTAGRAM_CLIENT_ID || "",
    clientSecret: process.env.INSTAGRAM_CLIENT_SECRET || "",
  },
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || "",
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || "",
    privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL || "SELF_ONLY",
  },
};

for (const dir of [config.dataDir, config.uploadsDir, config.clipsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export default config;
