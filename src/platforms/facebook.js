import config from "../config.js";

// Publishes clips as Reels on Facebook Pages via the Graph API. Connecting
// stores each Page the user manages as its own account (Page access tokens
// derived from a long-lived user token don't expire). Reels ingest the clip
// from a public URL, so BASE_URL must be reachable from the internet.

const GRAPH = "https://graph.facebook.com/v23.0";

export function isConfigured() {
  return Boolean(config.facebook.appId && config.facebook.appSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/facebook/callback`;
}

export function authUrl(state) {
  // auth_type=rerequest forces the permission/Page-picker screen on every
  // connect. Without it Facebook silently reuses the first grant, so Pages
  // added later never appear when reconnecting.
  const params = new URLSearchParams({
    client_id: config.facebook.appId,
    redirect_uri: redirectUri(),
    response_type: "code",
    auth_type: "rerequest",
    state,
  });
  // "Facebook Login for Business" (Business-type apps) replaces scope with a
  // dashboard-created configuration; the legacy scope param covers Consumer
  // apps with classic Facebook Login.
  if (config.facebook.configId) {
    params.set("config_id", config.facebook.configId);
  } else {
    params.set("scope", "pages_show_list,pages_manage_posts,pages_read_engagement");
  }
  return `https://www.facebook.com/v23.0/dialog/oauth?${params}`;
}

export async function handleCallback(code) {
  const shortRes = await fetch(
    `${GRAPH}/oauth/access_token?client_id=${config.facebook.appId}` +
      `&client_secret=${config.facebook.appSecret}` +
      `&redirect_uri=${encodeURIComponent(redirectUri())}&code=${encodeURIComponent(code)}`
  );
  const short = await shortRes.json();
  if (!shortRes.ok) throw new Error(`Facebook token exchange failed: ${JSON.stringify(short)}`);

  const longRes = await fetch(
    `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
      `&client_id=${config.facebook.appId}&client_secret=${config.facebook.appSecret}` +
      `&fb_exchange_token=${short.access_token}`
  );
  const long = await longRes.json();
  if (!longRes.ok) throw new Error(`Facebook long-lived token failed: ${JSON.stringify(long)}`);

  const pagesRes = await fetch(
    `${GRAPH}/me/accounts?fields=id,name,access_token&limit=25&access_token=${long.access_token}`
  );
  const pages = await pagesRes.json();
  if (!pagesRes.ok) throw new Error(`Facebook pages lookup failed: ${JSON.stringify(pages)}`);
  if (!pages.data?.length) {
    throw new Error("No Facebook Pages found - the app publishes to Pages, create one first");
  }

  return {
    accounts: pages.data.map((page) => ({
      accessToken: page.access_token,
      refreshToken: null,
      expiresAt: null, // Page tokens from a long-lived user token don't expire
      externalId: String(page.id),
      displayName: page.name,
    })),
  };
}

export async function refresh() {
  throw new Error("Facebook Page tokens cannot be auto-refreshed - reconnect the account");
}

export async function uploadClip(account, { publicUrl, caption }) {
  const startRes = await fetch(`${GRAPH}/${account.external_id}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ upload_phase: "start", access_token: account.access_token }),
  });
  const start = await startRes.json();
  if (!startRes.ok || !start.video_id) {
    throw new Error(`Facebook reel init failed: ${JSON.stringify(start)}`);
  }

  // Hand Facebook the public clip URL; it downloads and processes it.
  const uploadRes = await fetch(
    start.upload_url || `https://rupload.facebook.com/video-upload/v23.0/${start.video_id}`,
    {
      method: "POST",
      headers: {
        Authorization: `OAuth ${account.access_token}`,
        file_url: publicUrl,
      },
    }
  );
  const uploaded = await uploadRes.json().catch(() => ({}));
  if (!uploadRes.ok || uploaded.success === false) {
    throw new Error(`Facebook reel upload failed: ${JSON.stringify(uploaded)}`);
  }

  const finishRes = await fetch(`${GRAPH}/${account.external_id}/video_reels`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      upload_phase: "finish",
      video_id: start.video_id,
      video_state: "PUBLISHED",
      description: caption,
      access_token: account.access_token,
    }),
  });
  const finish = await finishRes.json();
  if (!finishRes.ok) throw new Error(`Facebook reel publish failed: ${JSON.stringify(finish)}`);
  return String(start.video_id);
}

// Returns a map of videoId -> {views, likes, comments}. Regular video fields
// first, falling back to reel insights where "views" isn't exposed.
export async function fetchStats(account, videoIds) {
  const stats = {};
  for (const id of videoIds) {
    const res = await fetch(
      `${GRAPH}/${id}?fields=views,likes.summary(true),comments.summary(true)&access_token=${account.access_token}`
    );
    const data = await res.json();
    if (res.ok) {
      let views = Number(data.views || 0);
      if (!views) {
        const insRes = await fetch(
          `${GRAPH}/${id}/video_insights/blue_reels_play_count?access_token=${account.access_token}`
        );
        const ins = await insRes.json();
        if (insRes.ok) views = Number(ins.data?.[0]?.values?.[0]?.value || 0);
      }
      stats[id] = {
        views,
        likes: Number(data.likes?.summary?.total_count || 0),
        comments: Number(data.comments?.summary?.total_count || 0),
      };
    }
  }
  return stats;
}
