import config from "../config.js";

// Uses the "Instagram API with Instagram Login" (graph.instagram.com).
// Publishing works by handing Instagram a public URL to the clip, so
// BASE_URL must be reachable from the internet.

const GRAPH = "https://graph.instagram.com/v23.0";

export function isConfigured() {
  return Boolean(config.instagram.clientId && config.instagram.clientSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/instagram/callback`;
}

export function authUrl(state) {
  // enable_fb_login=0 + force_authentication=1 mirror the URL Meta's own
  // dashboard generates for Business Login. Without them the flow depends on
  // the browser's instagram.com cookie session, which intermittently fails
  // with a bogus "Invalid redirect_uri" when logged out / multi-account.
  const params = new URLSearchParams({
    enable_fb_login: "0",
    force_authentication: "1",
    client_id: config.instagram.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_content_publish,instagram_business_manage_insights",
    state,
  });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

export async function handleCallback(code) {
  const shortRes = await fetch("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.instagram.clientId,
      client_secret: config.instagram.clientSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    }),
  });
  const short = await shortRes.json();
  if (!shortRes.ok) {
    // Meta reuses the "redirect_uri is identical" message for unrelated
    // failures (used/expired codes, transient errors). Include what we sent
    // so a real mismatch with the dashboard is visible at a glance.
    throw new Error(
      `Instagram token exchange failed: ${JSON.stringify(short)} ` +
        `(redirect_uri sent: ${redirectUri()} - must be listed EXACTLY in the app's Business login settings; ` +
        `if it matches, the one-time code was stale - just retry Connect)`
    );
  }

  const longRes = await fetch(
    `https://graph.instagram.com/access_token?grant_type=ig_exchange_token` +
      `&client_secret=${config.instagram.clientSecret}&access_token=${short.access_token}`
  );
  const long = await longRes.json();
  if (!longRes.ok) throw new Error(`Instagram long-lived token failed: ${JSON.stringify(long)}`);

  let displayName = "Instagram account";
  let externalId = String(short.user_id || "");
  try {
    const meRes = await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${long.access_token}`);
    const me = await meRes.json();
    if (meRes.ok) {
      displayName = me.username ? `@${me.username}` : displayName;
      externalId = String(me.user_id || externalId);
    }
  } catch {
    // Cosmetic only.
  }

  return {
    accessToken: long.access_token,
    refreshToken: null,
    expiresAt: Date.now() + (long.expires_in || 60 * 24 * 3600) * 1000,
    externalId,
    displayName,
  };
}

export async function refresh(account) {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${account.access_token}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Instagram token refresh failed: ${JSON.stringify(data)}`);
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresAt: Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000,
  };
}

async function waitForContainer(containerId, accessToken) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`);
    const data = await res.json();
    if (data.status_code === "FINISHED") return;
    if (data.status_code === "ERROR") {
      throw new Error(`Instagram media container failed: ${JSON.stringify(data)}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Instagram media container timed out");
}

// Returns a map of mediaId -> {views, likes, comments, shares, saves}.
// Insights are fetched per media; failures on individual posts are skipped.
export async function fetchStats(account, mediaIds) {
  const stats = {};
  for (const id of mediaIds) {
    for (const metricSet of ["views,likes,comments,shares,saved", "plays,likes,comments,shares,saved"]) {
      const res = await fetch(
        `${GRAPH}/${id}/insights?metric=${metricSet}&access_token=${account.access_token}`
      );
      const data = await res.json();
      if (!res.ok) continue; // older accounts/media may only support "plays"
      const byName = Object.fromEntries(
        (data.data || []).map((m) => [m.name, Number(m.values?.[0]?.value || 0)])
      );
      stats[id] = {
        views: byName.views ?? byName.plays ?? 0,
        likes: byName.likes ?? 0,
        comments: byName.comments ?? 0,
        shares: byName.shares ?? 0,
        saves: byName.saved ?? 0,
      };
      break;
    }
  }
  return stats;
}

export async function uploadClip(account, { publicUrl, caption }) {
  const userId = account.external_id || "me";
  const createRes = await fetch(`${GRAPH}/${userId}/media`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "REELS",
      video_url: publicUrl,
      caption,
      access_token: account.access_token,
    }),
  });
  const container = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`Instagram container create failed: ${JSON.stringify(container)}`);
  }

  await waitForContainer(container.id, account.access_token);

  const publishRes = await fetch(`${GRAPH}/${userId}/media_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: account.access_token,
    }),
  });
  const published = await publishRes.json();
  if (!publishRes.ok) {
    throw new Error(`Instagram publish failed: ${JSON.stringify(published)}`);
  }
  return String(published.id);
}
