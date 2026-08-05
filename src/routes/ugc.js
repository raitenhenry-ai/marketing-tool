import { Router } from "express";
import config from "../config.js";
import { q, q1, run as dbRun } from "../db.js";
import { platforms } from "../scheduler.js";
import { postUrl } from "../postUrl.js";
import { toneOptions } from "../ugc/script.js";
import { heygenConfigured } from "../ugc/heygen.js";
import {
  enqueueUgcJob, postJob, pickProvider, ugcQueueLength, deleteJobFiles,
} from "../ugc/pipeline.js";

const router = Router();

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error(`[ugc-api] ${req.method} ${req.path} failed:`, err);
    if (!res.headersSent) res.status(500).json({ error: String(err.message || err) });
  });

const PLATFORM_KEYS = Object.keys(platforms);

function shapeJob(job, posts = []) {
  const product = job.product_json ? JSON.parse(job.product_json) : null;
  const script = job.script_json ? JSON.parse(job.script_json) : null;
  return {
    id: job.id,
    productUrl: job.product_url,
    product,
    script,
    settings: JSON.parse(job.settings_json || "{}"),
    status: job.status,
    error: job.error,
    provider: job.provider,
    autoPost: Boolean(job.auto_post),
    videoUrl: job.video_filename ? `/ugc-media/${encodeURIComponent(job.video_filename)}` : null,
    createdAt: Number(job.created_at),
    updatedAt: Number(job.updated_at),
    posts: posts.map((p) => ({
      id: p.id,
      platform: p.platform,
      accountName: p.account_name,
      status: p.status,
      error: p.error,
      postedAt: p.posted_at ? Number(p.posted_at) : null,
      url: p.status === "done" ? postUrl(p) : null,
    })),
  };
}

async function postsFor(jobId) {
  return q(
    `SELECT ugc_posts.*, accounts.display_name AS account_name
     FROM ugc_posts LEFT JOIN accounts ON accounts.id = ugc_posts.account_id
     WHERE ugc_posts.job_id = ? ORDER BY ugc_posts.platform, ugc_posts.id`,
    [jobId]
  );
}

// Everything the UGC page needs to draw itself: connected accounts,
// generator capabilities, and headline numbers.
router.get("/overview", wrap(async (req, res) => {
  const accountRows = await q(
    "SELECT id, platform, display_name FROM accounts ORDER BY platform, id"
  );
  const accounts = Object.fromEntries(PLATFORM_KEYS.map((k) => [k, []]));
  for (const a of accountRows) {
    accounts[a.platform]?.push({ id: a.id, displayName: a.display_name });
  }

  const count = async (sql, params = []) => Number((await q1(sql, params))?.n || 0);
  res.json({
    accounts,
    platformsConfigured: Object.fromEntries(
      PLATFORM_KEYS.map((k) => [k, platforms[k].isConfigured()])
    ),
    generator: {
      provider: pickProvider(),
      heygenConfigured: heygenConfigured(),
      openaiConfigured: Boolean(config.openaiApiKey),
      tones: toneOptions(),
      queueDepth: ugcQueueLength(),
    },
    totals: {
      jobs: await count("SELECT COUNT(*) AS n FROM ugc_jobs"),
      videosReady: await count(
        "SELECT COUNT(*) AS n FROM ugc_jobs WHERE video_filename IS NOT NULL"
      ),
      posted: await count("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'done'"),
      failedPosts: await count("SELECT COUNT(*) AS n FROM ugc_posts WHERE status = 'failed'"),
      connectedAccounts: accountRows.length,
    },
  });
}));

router.post("/jobs", wrap(async (req, res) => {
  const productUrl = String(req.body.productUrl || "").trim();
  try {
    const parsed = new URL(productUrl);
    if (!/^https?:$/.test(parsed.protocol)) throw new Error();
  } catch {
    return res.status(400).json({ error: "Enter a valid product URL (https://...)" });
  }

  const wanted = Array.isArray(req.body.platforms)
    ? req.body.platforms.filter((p) => PLATFORM_KEYS.includes(p))
    : [];
  const settings = {
    tone: toneOptions().includes(req.body.tone) ? req.body.tone : "casual",
    platforms: wanted,
    provider: ["heygen", "local", "auto"].includes(req.body.provider) ? req.body.provider : undefined,
    voice: typeof req.body.voice === "string" ? req.body.voice.slice(0, 40) : undefined,
  };
  const autoPost = req.body.autoPost === false ? 0 : 1;

  const now = Date.now();
  const row = await q1(
    `INSERT INTO ugc_jobs (product_url, settings_json, status, auto_post, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?) RETURNING id`,
    [productUrl, JSON.stringify(settings), autoPost, now, now]
  );
  enqueueUgcJob(row.id);
  res.json({ id: row.id, status: "queued" });
}));

router.get("/jobs", wrap(async (req, res) => {
  const jobs = await q("SELECT * FROM ugc_jobs ORDER BY created_at DESC LIMIT 100");
  const out = [];
  for (const job of jobs) out.push(shapeJob(job, await postsFor(job.id)));
  res.json(out);
}));

router.get("/jobs/:id", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  res.json(shapeJob(job, await postsFor(job.id)));
}));

// Re-run a failed job from the stage it died at (scrape/script results are
// kept when they succeeded).
router.post("/jobs/:id/retry", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (job.status !== "failed") {
    return res.status(400).json({ error: "Only failed jobs can be retried" });
  }
  await dbRun("UPDATE ugc_jobs SET status = 'queued', error = NULL, updated_at = ? WHERE id = ?",
    [Date.now(), job.id]);
  enqueueUgcJob(job.id);
  res.json({ ok: true });
}));

// Throw away the script + video and generate everything again.
router.post("/jobs/:id/regenerate", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  if (["queued", "scraping", "scripting", "rendering", "posting"].includes(job.status)) {
    return res.status(400).json({ error: "Job is still working - wait for it to finish" });
  }
  await deleteJobFiles(job);
  await dbRun(
    `UPDATE ugc_jobs SET status = 'queued', error = NULL, script_json = NULL,
     video_filename = NULL, updated_at = ? WHERE id = ?`,
    [Date.now(), job.id]
  );
  await dbRun("DELETE FROM ugc_posts WHERE job_id = ?", [job.id]);
  enqueueUgcJob(job.id);
  res.json({ ok: true });
}));

// Post (or re-post failures) right now. body: { onlyFailed: true } retries
// just the accounts that failed.
router.post("/jobs/:id/post", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const result = await postJob(job.id, { onlyFailed: Boolean(req.body.onlyFailed) });
  res.json(result);
}));

router.delete("/jobs/:id", wrap(async (req, res) => {
  const job = await q1("SELECT * FROM ugc_jobs WHERE id = ?", [req.params.id]);
  if (!job) return res.status(404).json({ error: "Job not found" });
  await deleteJobFiles(job);
  await dbRun("DELETE FROM ugc_jobs WHERE id = ?", [job.id]);
  res.json({ ok: true });
}));

export default router;
