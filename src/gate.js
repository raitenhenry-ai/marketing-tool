import crypto from "node:crypto";
import config from "./config.js";

// Second lock in front of the ShortForm tool only. Everyone still signs in
// through the normal login first; opening the ShortForm dashboard (or its
// APIs) additionally asks for SHORTFORM_PASSWORD once per browser session.
// The UGC studio is deliberately NOT behind this gate.
//
// Unlocks live in memory (like login sessions), so a restart re-locks.

const UNLOCK_TTL_MS = 30 * 24 * 3600 * 1000;
const unlocks = new Map(); // token -> expiry
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

export function gateEnabled() {
  return Boolean(config.shortformPassword);
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

export function gateUnlocked(req) {
  if (!gateEnabled()) return true;
  const token = parseCookies(req).sfgate;
  if (!token) return false;
  const expires = unlocks.get(token);
  if (!expires || expires < Date.now()) {
    unlocks.delete(token);
    return false;
  }
  return true;
}

// Everything belonging to the ShortForm tool sits behind the gate: its
// static pages (/343k), its APIs (/api) and the platform OAuth flows
// (/auth). The UGC studio (/ugc, /ugc/api) deliberately skips this.
const GATED_PREFIXES = ["/343k", "/api", "/auth"];

export function gateMiddleware(req, res, next) {
  const gated = GATED_PREFIXES.some(
    (p) => req.path === p || req.path.startsWith(`${p}/`)
  );
  if (!gated || gateUnlocked(req)) return next();
  if (req.path.startsWith("/api/")) {
    return res.status(403).json({ error: "shortform_locked" });
  }
  res.redirect("/gate");
}

function gatePage(error) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Unlock ShortForm · Clint</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon-512.png">
<script>document.documentElement.dataset.theme = localStorage.getItem("theme") || "light";</script>
<style>
  :root{--bg:#0a0d13;--surface:#10141c;--border:#222a3a;--text:#e7eaf1;--muted:#6d7688;--accent:#3b76f0;--err:#dd5959}
  :root[data-theme="light"]{--bg:#f3f5f9;--surface:#fff;--border:#d4dae6;--text:#1b2334;--muted:#687087;--accent:#2e63d8;--err:#c23b3b}
  *{box-sizing:border-box}
  body{font-family:-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);
       display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:20px}
  .card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:34px;width:100%;max-width:360px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:20px;text-decoration:none;color:var(--text)}
  .mark{width:38px;height:38px;display:block}
  .sub{font-size:11px;color:var(--muted)}
  h1{font-size:1.15rem;margin:0 0 6px}
  p{color:var(--muted);font-size:.9rem;line-height:1.5;margin:0 0 16px}
  input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;
        color:var(--text);padding:11px 12px;margin-bottom:12px;font-size:.95rem}
  input:focus{outline:none;border-color:var(--accent)}
  button{width:100%;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:11px;font-size:.95rem;
         font-weight:600;cursor:pointer}
  .err{color:var(--err);font-size:.85rem;margin-bottom:12px}
  .alt{font-size:.85rem;color:var(--muted);margin-top:16px;text-align:center}
  .alt a{color:var(--accent);text-decoration:none}
</style></head><body>
<form class="card" method="post" action="/gate">
  <a class="brand" href="/hub">
    <img class="mark" src="/logo.svg" alt="">
    <div><div style="font-weight:700">ShortForm Manager</div><div class="sub">restricted tool</div></div>
  </a>
  <h1>Tool password 🔒</h1>
  <p>The ShortForm manager needs its own password on top of your login.</p>
  ${error ? `<div class="err">Wrong password, try again.</div>` : ""}
  <input type="password" name="password" placeholder="Tool password" autocomplete="off" autofocus required>
  <button type="submit">Unlock</button>
  <div class="alt"><a href="/hub">← Back to tools</a></div>
</form></body></html>`;
}

export function registerGateRoutes(app) {
  app.get("/gate", (req, res) => {
    if (gateUnlocked(req)) return res.redirect("/343k/");
    res.send(gatePage(req.query.error));
  });

  app.post("/gate", (req, res) => {
    const ip = req.socket.remoteAddress || "unknown";
    const entry = attempts.get(ip);
    if (entry && entry.count >= MAX_ATTEMPTS && entry.resetAt > Date.now()) {
      return res.status(429).send("Too many attempts - try again in a few minutes.");
    }

    if (!safeEqual(String(req.body.password || ""), config.shortformPassword)) {
      const cur = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: 0 };
      attempts.set(ip, { count: cur.count + 1, resetAt: Date.now() + LOCKOUT_MS });
      return res.redirect("/gate?error=1");
    }

    attempts.delete(ip);
    const token = crypto.randomBytes(32).toString("hex");
    unlocks.set(token, Date.now() + UNLOCK_TTL_MS);
    res.setHeader(
      "Set-Cookie",
      `sfgate=${token}; HttpOnly; Path=/; Max-Age=${UNLOCK_TTL_MS / 1000}; SameSite=Lax`
    );
    res.redirect("/343k/");
  });
}
