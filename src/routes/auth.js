import { Router } from "express";
import config from "../config.js";
import db from "../db.js";
import { createState, consumeState } from "../oauthState.js";
import * as youtube from "../platforms/youtube.js";
import * as instagram from "../platforms/instagram.js";
import * as tiktok from "../platforms/tiktok.js";

const platforms = { youtube, instagram, tiktok };
const router = Router();

router.get("/:platform", (req, res) => {
  const platform = platforms[req.params.platform];
  if (!platform) return res.status(404).send("Unknown platform");
  if (!platform.isConfigured()) {
    return res
      .status(400)
      .send(`${req.params.platform} API credentials are not set - see .env.example`);
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE platform = ?")
    .get(req.params.platform).n;
  if (count >= config.maxAccountsPerPlatform) {
    return res.redirect(
      `/?connect_error=${encodeURIComponent(
        `Limit of ${config.maxAccountsPerPlatform} ${req.params.platform} accounts reached - disconnect one first`
      )}`
    );
  }
  res.redirect(platform.authUrl(createState(req.params.platform)));
});

router.get("/:platform/callback", async (req, res) => {
  const name = req.params.platform;
  const platform = platforms[name];
  if (!platform) return res.status(404).send("Unknown platform");

  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return res.redirect(`/?connect_error=${encodeURIComponent(errorDescription || error)}`);
  }
  if (!code || !consumeState(state, name)) {
    return res.redirect(`/?connect_error=${encodeURIComponent("Invalid OAuth state, try again")}`);
  }

  try {
    const account = await platform.handleCallback(code);

    // Reconnecting an already-linked account refreshes it in place and does
    // not consume a slot; only genuinely new accounts count toward the limit.
    const existing = account.externalId
      ? db.prepare("SELECT id FROM accounts WHERE platform = ? AND external_id = ?")
          .get(name, account.externalId)
      : null;
    if (!existing) {
      const count = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE platform = ?").get(name).n;
      if (count >= config.maxAccountsPerPlatform) {
        return res.redirect(
          `/?connect_error=${encodeURIComponent(
            `Limit of ${config.maxAccountsPerPlatform} ${name} accounts reached - disconnect one first`
          )}`
        );
      }
    }

    db.prepare(
      `INSERT INTO accounts (platform, access_token, refresh_token, expires_at, external_id, display_name, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (platform, external_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, accounts.refresh_token),
         expires_at = excluded.expires_at,
         display_name = excluded.display_name,
         connected_at = excluded.connected_at`
    ).run(
      name,
      account.accessToken,
      account.refreshToken,
      account.expiresAt,
      account.externalId,
      account.displayName,
      Date.now()
    );
    res.redirect("/?connected=" + name);
  } catch (err) {
    console.error(`[auth] ${name} callback failed:`, err);
    res.redirect(`/?connect_error=${encodeURIComponent(String(err.message || err))}`);
  }
});

router.post("/accounts/:id/disconnect", (req, res) => {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
