import crypto from "node:crypto";
import config from "./config.js";

// Cookie-session login for the dashboard. Enabled by setting ADMIN_PASSWORD;
// without it the app runs open (fine for localhost, logged as a warning when
// BASE_URL is public). Sessions live in memory, so a restart logs everyone
// out - harmless for a single-admin tool.

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const sessions = new Map(); // token -> expires epoch ms
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export function authEnabled() {
  return Boolean(config.adminPassword);
}

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function isAuthed(req) {
  const token = parseCookies(req).session;
  if (!token) return false;
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

export function authMiddleware(req, res, next) {
  if (!authEnabled() || isAuthed(req)) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.redirect("/login");
}

function loginPage(error) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in</title>
<style>
  body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:#0f1218;color:#e8eaf0;
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
  form{background:#171c26;border:1px solid #262d3b;border-radius:12px;padding:32px;width:300px}
  h1{font-size:1.1rem;margin:0 0 16px}
  input{width:100%;box-sizing:border-box;background:#0f1218;border:1px solid #262d3b;border-radius:8px;
        color:#e8eaf0;padding:10px 12px;margin-bottom:12px;font-size:1rem}
  button{width:100%;background:#2f6fed;color:#fff;border:0;border-radius:8px;padding:10px;font-size:1rem;cursor:pointer}
  .err{color:#d89f9f;font-size:.85rem;margin-bottom:12px}
</style></head><body>
<form method="post" action="/login">
  <h1>Short-Form Content Manager</h1>
  ${error ? '<div class="err">Wrong password, try again.</div>' : ""}
  <input type="password" name="password" placeholder="Password" autofocus required>
  <button type="submit">Sign in</button>
</form></body></html>`;
}

export function registerAuthRoutes(app) {
  app.get("/login", (req, res) => {
    if (!authEnabled() || isAuthed(req)) return res.redirect("/");
    res.send(loginPage(req.query.error));
  });

  app.post("/login", (req, res) => {
    if (!authEnabled()) return res.redirect("/");

    const ip = req.socket.remoteAddress || "unknown";
    const entry = attempts.get(ip);
    if (entry && entry.count >= MAX_ATTEMPTS && entry.resetAt > Date.now()) {
      return res.status(429).send("Too many attempts - try again in a few minutes.");
    }

    if (!safeEqual(req.body.password || "", config.adminPassword)) {
      const cur = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: 0 };
      attempts.set(ip, { count: cur.count + 1, resetAt: Date.now() + LOCKOUT_MS });
      return res.redirect("/login?error=1");
    }

    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    sessions.set(token, Date.now() + SESSION_TTL_MS);
    res.setHeader(
      "Set-Cookie",
      `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`
    );
    res.redirect("/");
  });

  app.post("/logout", (req, res) => {
    sessions.delete(parseCookies(req).session);
    res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
    res.redirect("/login");
  });
}
