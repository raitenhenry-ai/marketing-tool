import config from "../config.js";

// Publishes clips as video posts on Threads via the Threads API
// (graph.threads.net). Like Instagram, Threads ingests the clip from a
// public URL, so BASE_URL must be reachable from the internet.

const GRAPH = "https://graph.threads.net/v1.0";

export function isConfigured() {
  return Boolean(config.threads.appId && config.threads.appSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/threads/callback`;
}

export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.threads.appId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "threads_basic,threads_content_publish,threads_manage_insights",
    state,
  });
  return `https://threads.net/oauth/authorize?${params}`;
}

export async function handleCallback(code) {
  const shortRes = await fetch("https://graph.threads.net/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.threads.appId,
      client_secret: config.threads.appSecret,
      grant_type: "authorization_code",
      redirect_uri: redirectUri(),
      code,
    }),
  });
  const short = await shortRes.json();
  if (!shortRes.ok) throw new Error(`Threads token exchange failed: ${JSON.stringify(short)}`);

  const longRes = await fetch(
    `${GRAPH.replace("/v1.0", "")}/access_token?grant_type=th_exchange_token` +
      `&client_secret=${config.threads.appSecret}&access_token=${short.access_token}`
  );
  const long = await longRes.json();
  if (!longRes.ok) throw new Error(`Threads long-lived token failed: ${JSON.stringify(long)}`);

  let externalId = String(short.user_id || "");
  let displayName = "Threads account";
  try {
    const meRes = await fetch(`${GRAPH}/me?fields=id,username&access_token=${long.access_token}`);
    const me = await meRes.json();
    if (meRes.ok) {
      externalId = String(me.id || externalId);
      displayName = me.username ? `@${me.username}` : displayName;
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
    `${GRAPH.replace("/v1.0", "")}/refresh_access_token?grant_type=th_refresh_token&access_token=${account.access_token}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Threads token refresh failed: ${JSON.stringify(data)}`);
  return {
    accessToken: data.access_token,
    refreshToken: null,
    expiresAt: Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000,
  };
}

async function waitForContainer(containerId, accessToken) {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(
      `${GRAPH}/${containerId}?fields=status,error_message&access_token=${accessToken}`
    );
    const data = await res.json();
    if (data.status === "FINISHED") return;
    if (data.status === "ERROR") {
      throw new Error(`Threads media container failed: ${JSON.stringify(data)}`);
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Threads media container timed out");
}

export async function uploadClip(account, { publicUrl, caption }) {
  const userId = account.external_id || "me";
  // Threads posts cap at 500 characters.
  const text = caption.length > 495 ? `${caption.slice(0, 492).trimEnd()}…` : caption;

  const createRes = await fetch(`${GRAPH}/${userId}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      media_type: "VIDEO",
      video_url: publicUrl,
      text,
      access_token: account.access_token,
    }),
  });
  const container = await createRes.json();
  if (!createRes.ok) {
    throw new Error(`Threads container create failed: ${JSON.stringify(container)}`);
  }

  await waitForContainer(container.id, account.access_token);

  const publishRes = await fetch(`${GRAPH}/${userId}/threads_publish`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      creation_id: container.id,
      access_token: account.access_token,
    }),
  });
  const published = await publishRes.json();
  if (!publishRes.ok) throw new Error(`Threads publish failed: ${JSON.stringify(published)}`);
  return String(published.id);
}

// Returns a map of mediaId -> {views, likes, comments, shares}.
// Public link to a published post (used for "view post" links in the UI).
export async function resolvePostId(account, mediaId) {
  const res = await fetch(`${GRAPH}/${mediaId}?fields=permalink&access_token=${account.access_token}`);
  const data = await res.json();
  return res.ok ? data.permalink || null : null;
}

export async function fetchStats(account, mediaIds) {
  const stats = {};
  for (const id of mediaIds) {
    const res = await fetch(
      `${GRAPH}/${id}/insights?metric=views,likes,replies,reposts,quotes&access_token=${account.access_token}`
    );
    const data = await res.json();
    if (!res.ok) continue;
    const byName = Object.fromEntries(
      (data.data || []).map((m) => [m.name, Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0)])
    );
    stats[id] = {
      views: byName.views ?? 0,
      likes: byName.likes ?? 0,
      comments: byName.replies ?? 0,
      shares: (byName.reposts ?? 0) + (byName.quotes ?? 0),
    };
  }
  return stats;
}
