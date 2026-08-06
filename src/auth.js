import crypto from "node:crypto";
import config from "./config.js";
import { q1, run } from "./db.js";

// Email+password auth with public signup. The operator (full dashboard
// access) is whoever signs in with ADMIN_PASSWORD, or a user row with
// role 'operator'. Public signups become 'member' accounts that land on an
// early-access waitlist page - they never see the operator's workspace.
// Sessions live in memory, so a restart logs everyone out.

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const sessions = new Map(); // token -> { expires, role, email }
const attempts = new Map(); // ip -> { count, resetAt }
const MAX_ATTEMPTS = 8;
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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64).toString("hex");
  return safeEqual(candidate, hash);
}

function sessionOf(req) {
  const token = parseCookies(req).session;
  if (!token) return null;
  const s = sessions.get(token);
  if (!s || s.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return s;
}

function startSession(res, role, email) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { expires: Date.now() + SESSION_TTL_MS, role, email });
  res.setHeader(
    "Set-Cookie",
    `session=${token}; HttpOnly; Path=/; Max-Age=${SESSION_TTL_MS / 1000}; SameSite=Lax`
  );
}

function rateLimited(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  const entry = attempts.get(ip);
  if (entry && entry.count >= MAX_ATTEMPTS && entry.resetAt > Date.now()) {
    res.status(429).send("Too many attempts - try again in a few minutes.");
    return true;
  }
  return false;
}

function recordFailure(req) {
  const ip = req.socket.remoteAddress || "unknown";
  const entry = attempts.get(ip);
  const cur = entry && entry.resetAt > Date.now() ? entry : { count: 0, resetAt: 0 };
  attempts.set(ip, { count: cur.count + 1, resetAt: Date.now() + LOCKOUT_MS });
}

// The dashboard and its APIs are operator-only; signed-in members are sent
// to the waitlist page instead.
export function authMiddleware(req, res, next) {
  if (!authEnabled()) return next();
  const session = sessionOf(req);
  if (session?.role === "operator") return next();
  if (req.path.startsWith("/api/")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  res.redirect(session ? "/pending" : "/login");
}

/* ---------- Pages ---------- */

function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Clint</title>
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
  h1{font-size:1.15rem;margin:0 0 16px}
  input{width:100%;background:var(--bg);border:1px solid var(--border);border-radius:8px;
        color:var(--text);padding:11px 12px;margin-bottom:12px;font-size:.95rem}
  input:focus{outline:none;border-color:var(--accent)}
  button{width:100%;background:var(--accent);color:#fff;border:0;border-radius:8px;padding:11px;font-size:.95rem;
         font-weight:600;cursor:pointer}
  .err{color:var(--err);font-size:.85rem;margin-bottom:12px}
  .alt{font-size:.85rem;color:var(--muted);margin-top:16px;text-align:center}
  .alt a{color:var(--accent);text-decoration:none}
  p{line-height:1.6;color:var(--muted);font-size:.92rem}
</style></head><body>${body}</body></html>`;
}

const brand = `<a class="brand" href="/">
  <img class="mark" src="/logo.svg" alt="">
  <div><div style="font-weight:700">Clint</div><div class="sub">short-form content manager</div></div>
</a>`;

const LOGIN_ERRORS = {
  1: "Wrong email or password, try again.",
  2: "Enter your email and password.",
};

function loginPage(error) {
  return page("Sign in", `<form class="card" method="post" action="/login">
  ${brand}
  <h1>Sign in</h1>
  ${LOGIN_ERRORS[error] ? `<div class="err">${LOGIN_ERRORS[error]}</div>` : ""}
  <input type="email" name="email" placeholder="Email" autocomplete="email" autofocus required>
  <input type="password" name="password" placeholder="Password" autocomplete="current-password" required>
  <button type="submit">Sign in</button>
  <div class="alt">New here? <a href="/signup">Create an account</a></div>
</form>`);
}

const SIGNUP_ERRORS = {
  1: "Enter a valid email address.",
  2: "Password needs at least 8 characters.",
  3: "An account with that email already exists - sign in instead.",
};

function signupPage(error) {
  return page("Create account", `<form class="card" method="post" action="/signup">
  ${brand}
  <h1>Create your account</h1>
  ${SIGNUP_ERRORS[error] ? `<div class="err">${SIGNUP_ERRORS[error]}</div>` : ""}
  <input type="email" name="email" placeholder="Email" autocomplete="email" autofocus required>
  <input type="password" name="password" placeholder="Password (8+ characters)" autocomplete="new-password" minlength="8" required>
  <button type="submit">Get started</button>
  <div class="alt">Already have an account? <a href="/login">Sign in</a></div>
</form>`);
}

function pendingPage(email) {
  return page("Almost there", `<div class="card">
  ${brand}
  <h1>You're on the list 🎉</h1>
  <p>Thanks for signing up${email ? ` with <strong style="color:var(--text)">${email.replace(/</g, "&lt;")}</strong>` : ""}.
     We're onboarding new workspaces in small batches while we scale up processing capacity.</p>
  <p>You'll get an email as soon as your workspace is ready - most invites go out within a few days.</p>
  <form method="post" action="/logout" style="margin-top:18px"><button type="submit">Sign out</button></form>
</div>`);
}

/* ---------- Routes ---------- */

export function registerAuthRoutes(app) {
  app.get("/login", (req, res) => {
    const session = sessionOf(req);
    if (!authEnabled() || session?.role === "operator") return res.redirect("/hub");
    if (session) return res.redirect("/pending");
    res.send(loginPage(req.query.error));
  });

  app.post("/login", async (req, res) => {
    if (!authEnabled()) return res.redirect("/hub");
    if (rateLimited(req, res)) return;

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return res.redirect("/login?error=2");

    // Operator path: ADMIN_PASSWORD signs in with full access from any email.
    if (safeEqual(password, config.adminPassword)) {
      attempts.delete(req.socket.remoteAddress || "unknown");
      startSession(res, "operator", email);
      return res.redirect("/hub");
    }

    const user = await q1("SELECT * FROM users WHERE email = ?", [email]).catch(() => null);
    if (!user || !verifyPassword(password, user.password_hash)) {
      recordFailure(req);
      return res.redirect("/login?error=1");
    }

    attempts.delete(req.socket.remoteAddress || "unknown");
    startSession(res, user.role === "operator" ? "operator" : "member", email);
    res.redirect(user.role === "operator" ? "/hub" : "/pending");
  });

  app.get("/signup", (req, res) => {
    const session = sessionOf(req);
    if (session?.role === "operator") return res.redirect("/hub");
    if (session) return res.redirect("/pending");
    res.send(signupPage(req.query.error));
  });

  app.post("/signup", async (req, res) => {
    if (rateLimited(req, res)) return;
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.redirect("/signup?error=1");
    if (password.length < 8) return res.redirect("/signup?error=2");

    const existing = await q1("SELECT id FROM users WHERE email = ?", [email]).catch(() => null);
    if (existing) return res.redirect("/signup?error=3");

    recordFailure(req); // counts toward the rate limit to slow bulk signups
    await run(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'member', ?)",
      [email, hashPassword(password), Date.now()]
    );
    console.log(`[auth] new signup: ${email}`);
    startSession(res, "member", email);
    res.redirect("/pending");
  });

  app.get("/pending", (req, res) => {
    const session = sessionOf(req);
    if (!session) return res.redirect("/login");
    if (session.role === "operator") return res.redirect("/hub");
    res.send(pendingPage(session.email));
  });

  app.post("/logout", (req, res) => {
    sessions.delete(parseCookies(req).session);
    res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax");
    res.redirect("/login");
  });
}
