import express from "express";
import path from "node:path";
import { spawnSync } from "node:child_process";
import config from "./config.js";
import db from "./db.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import { registerAuthRoutes, authMiddleware, authEnabled } from "./auth.js";
import { startScheduler } from "./scheduler.js";
import { startCleanup } from "./cleanup.js";
import { recoverStuckVideos, queueLength } from "./processing.js";

// Timestamped logs.
for (const level of ["log", "warn", "error"]) {
  const original = console[level].bind(console);
  console[level] = (...args) => original(new Date().toISOString(), ...args);
}

function checkFfmpeg() {
  const result = spawnSync(config.ffmpegPath, ["-version"], { stdio: "ignore" });
  if (result.error || result.status !== 0) {
    console.error(
      `[startup] ffmpeg not found at "${config.ffmpegPath}" - install it or set FFMPEG_PATH. ` +
        "Video processing WILL fail until this is fixed."
    );
    return false;
  }
  return true;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Public: health probe and clip files (Instagram fetches clips by URL).
app.get("/healthz", (req, res) => {
  res.json({
    ok: true,
    uptimeSeconds: Math.round(process.uptime()),
    processingQueue: queueLength(),
    connectedAccounts: db.prepare("SELECT COUNT(*) AS n FROM accounts").get().n,
  });
});
app.use("/clips", express.static(config.clipsDir));

// Everything else sits behind the login when ADMIN_PASSWORD is set.
registerAuthRoutes(app);
app.use(authMiddleware);
app.use(express.static(path.join(config.rootDir, "public")));
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);

const server = app.listen(config.port, () => {
  console.log(`Short-form manager running at ${config.baseUrl} (port ${config.port})`);
  if (!authEnabled()) {
    console.warn(
      "[startup] ADMIN_PASSWORD is not set - the dashboard is open to anyone who can reach it. " +
        "Set it in .env before exposing this server to the internet."
    );
  }
  checkFfmpeg();
  const recovered = recoverStuckVideos();
  if (recovered) console.log(`[startup] recovered ${recovered} interrupted video(s)`);
  startScheduler();
  startCleanup();
});

// Finish in-flight requests, then close cleanly. Interrupted encodes are
// re-queued by recoverStuckVideos() on the next boot.
function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
