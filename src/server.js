import express from "express";
import path from "node:path";
import { spawnSync } from "node:child_process";
import config from "./config.js";
import { q1, closeDb, dbKind } from "./db.js";
import authRoutes from "./routes/auth.js";
import apiRoutes from "./routes/api.js";
import { registerAuthRoutes, authMiddleware, authEnabled } from "./auth.js";
import { startScheduler } from "./scheduler.js";
import { startCleanup } from "./cleanup.js";
import { startMetrics } from "./metrics.js";
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
app.get("/healthz", async (req, res) => {
  try {
    const accounts = Number((await q1("SELECT COUNT(*) AS n FROM accounts")).n);
    res.json({
      ok: true,
      database: dbKind,
      uptimeSeconds: Math.round(process.uptime()),
      processingQueue: queueLength(),
      connectedAccounts: accounts,
      // Which Facebook login flavor the RUNNING process will use - proves
      // whether FACEBOOK_CONFIG_ID actually reached this deployment.
      facebookLogin: config.facebook.configId
        ? `config_id (…${config.facebook.configId.slice(-4)})`
        : "scope (FACEBOOK_CONFIG_ID not set)",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});
app.use("/clips", express.static(config.clipsDir));

// Meta (Instagram/Facebook/Threads) webhook endpoint. The app dashboards
// insist on a callback URL + verify token; we answer the GET handshake and
// accept-and-ignore the POSTed events (this tool polls, it doesn't listen).
app.get("/webhooks/meta", (req, res) => {
  if (
    req.query["hub.mode"] === "subscribe" &&
    req.query["hub.verify_token"] === config.metaVerifyToken
  ) {
    return res.send(req.query["hub.challenge"]);
  }
  res.sendStatus(403);
});
app.post("/webhooks/meta", (req, res) => res.sendStatus(200));

// Public legal pages (also the policy URLs platform app reviews ask for).
const publicDir = path.join(config.rootDir, "public");

// Domain-verification files (TikTok etc.) must be publicly reachable at the
// site root: drop them in public/verification/ and they're served from /.
app.use(express.static(path.join(publicDir, "verification")));
app.get(["/terms", "/terms/"], (req, res) => res.sendFile(path.join(publicDir, "terms.html")));
app.get(["/privacy", "/privacy/"], (req, res) => res.sendFile(path.join(publicDir, "privacy.html")));

// Public product landing page (also what platform app reviews see).
app.get("/", (req, res) => res.sendFile(path.join(publicDir, "landing.html")));

// The dashboard lives under /343k; everything below sits behind the login
// when ADMIN_PASSWORD is set.
registerAuthRoutes(app);
app.use(authMiddleware);
app.use("/343k", express.static(publicDir));
app.use("/auth", authRoutes);
app.use("/api", apiRoutes);

const server = app.listen(config.port, async () => {
  console.log(`Short-form manager running at ${config.baseUrl} (port ${config.port})`);
  if (!authEnabled()) {
    console.warn(
      "[startup] ADMIN_PASSWORD is not set - the dashboard is open to anyone who can reach it. " +
        "Set it in .env before exposing this server to the internet."
    );
  }
  checkFfmpeg();
  const recovered = await recoverStuckVideos().catch((e) => {
    console.error("[startup] recovery failed:", e);
    return 0;
  });
  if (recovered) console.log(`[startup] recovered ${recovered} interrupted video(s)`);
  startScheduler();
  startCleanup();
  startMetrics();
});

// Finish in-flight requests, then close cleanly. Interrupted encodes are
// re-queued by recoverStuckVideos() on the next boot.
function shutdown(signal) {
  console.log(`[shutdown] received ${signal}, closing`);
  server.close(async () => {
    await Promise.resolve(closeDb()).catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 8000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
