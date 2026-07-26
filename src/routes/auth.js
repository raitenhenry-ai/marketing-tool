import { Router } from "express";
import crypto from "node:crypto";
import config from "../config.js";
import db from "../db.js";
import { createState, consumeState } from "../oauthState.js";
import * as youtube from "../platforms/youtube.js";
import * as instagram from "../platforms/instagram.js";
import * as tiktok from "../platforms/tiktok.js";
import * as facebook from "../platforms/facebook.js";
import * as x from "../platforms/x.js";

const platforms = { youtube, instagram, tiktok, facebook, x };
const router = Router();

router.get("/:platform", (req, res) => {
  const name = req.params.platform;
  const platform = platforms[name];
  if (!platform) return res.status(404).send("Unknown platform");
  if (!platform.isConfigured()) {
    return res.status(400).send(`${name} API credentials are not set - see .env.example`);
  }
  const count = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE platform = ?").get(name).n;
  if (count >= config.maxAccountsPerPlatform) {
    return res.redirect(
      `/accounts.html?connect_error=${encodeURIComponent(
        `Limit of ${config.maxAccountsPerPlatform} ${name} accounts reached - disconnect one first`
      )}`
    );
  }

  // X uses OAuth 2.0 PKCE: stash the verifier with the state.
  const extras = {};
  let stateData = null;
  if (name === "x") {
    const verifier = crypto.randomBytes(32).toString("base64url");
    extras.codeChallenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    stateData = { codeVerifier: verifier };
  }
  res.redirect(platform.authUrl(createState(name, stateData), extras));
});

router.get("/:platform/callback", async (req, res) => {
  const name = req.params.platform;
  const platform = platforms[name];
  if (!platform) return res.status(404).send("Unknown platform");

  const { code, state, error, error_description: errorDescription } = req.query;
  if (error) {
    return res.redirect(`/accounts.html?connect_error=${encodeURIComponent(errorDescription || error)}`);
  }
  const stateCheck = consumeState(state, name);
  if (!code || !stateCheck.ok) {
    return res.redirect(`/accounts.html?connect_error=${encodeURIComponent("Invalid OAuth state, try again")}`);
  }

  try {
    // Most platforms return one account; Facebook returns every managed Page.
    const result = await platform.handleCallback(code, stateCheck.data || {});
    const incoming = result.accounts || [result];

    const upsert = db.prepare(
      `INSERT INTO accounts (platform, access_token, refresh_token, expires_at, external_id, display_name, connected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (platform, external_id) DO UPDATE SET
         access_token = excluded.access_token,
         refresh_token = COALESCE(excluded.refresh_token, accounts.refresh_token),
         expires_at = excluded.expires_at,
         display_name = excluded.display_name,
         connected_at = excluded.connected_at`
    );

    let added = 0;
    for (const account of incoming) {
      // Reconnecting an already-linked account refreshes it in place and
      // does not consume a slot; new accounts respect the per-platform cap.
      const existing = account.externalId
        ? db.prepare("SELECT id FROM accounts WHERE platform = ? AND external_id = ?")
            .get(name, account.externalId)
        : null;
      if (!existing) {
        const count = db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE platform = ?").get(name).n;
        if (count >= config.maxAccountsPerPlatform) continue;
      }
      upsert.run(
        name,
        account.accessToken,
        account.refreshToken,
        account.expiresAt,
        account.externalId,
        account.displayName,
        Date.now()
      );
      added++;
    }

    if (!added) {
      return res.redirect(
        `/accounts.html?connect_error=${encodeURIComponent(
          `Limit of ${config.maxAccountsPerPlatform} ${name} accounts reached - disconnect one first`
        )}`
      );
    }
    res.redirect(`/accounts.html?connected=${name}`);
  } catch (err) {
    console.error(`[auth] ${name} callback failed:`, err);
    res.redirect(`/accounts.html?connect_error=${encodeURIComponent(String(err.message || err))}`);
  }
});

router.post("/accounts/:id/disconnect", (req, res) => {
  db.prepare("DELETE FROM accounts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

export default router;
