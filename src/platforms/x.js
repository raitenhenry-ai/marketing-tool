import fs from "node:fs";
import config from "../config.js";

// Posts clips as video tweets via the X API v2 (OAuth 2.0 with PKCE,
// chunked media upload, then tweet creation).

const API = "https://api.x.com";

export function isConfigured() {
  return Boolean(config.x.clientId && config.x.clientSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/x/callback`;
}

function basicAuth() {
  return `Basic ${Buffer.from(`${config.x.clientId}:${config.x.clientSecret}`).toString("base64")}`;
}

export function authUrl(state, { codeChallenge } = {}) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.x.clientId,
    redirect_uri: redirectUri(),
    scope: "tweet.read tweet.write users.read media.write offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://x.com/i/oauth2/authorize?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${API}/2/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`X token request failed: ${JSON.stringify(data)}`);
  return data;
}

export async function handleCallback(code, stateData = {}) {
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
    code_verifier: stateData.codeVerifier || "",
  });

  let externalId = null;
  let displayName = "X account";
  try {
    const meRes = await fetch(`${API}/2/users/me`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const me = await meRes.json();
    if (meRes.ok && me.data) {
      externalId = String(me.data.id);
      displayName = me.data.username ? `@${me.data.username}` : me.data.name || displayName;
    }
  } catch {
    // Cosmetic only.
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
    externalId,
    displayName,
  };
}

export async function refresh(account) {
  const data = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 7200) * 1000,
  };
}

async function apiJson(path, account, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      ...(options.body && !(options.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`X ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

export async function uploadClip(account, { filePath, caption }) {
  const size = fs.statSync(filePath).size;

  const init = await apiJson("/2/media/upload/initialize", account, {
    method: "POST",
    body: JSON.stringify({
      media_type: "video/mp4",
      total_bytes: size,
      media_category: "tweet_video",
    }),
  });
  const mediaId = init.data?.id;
  if (!mediaId) throw new Error(`X media init returned no id: ${JSON.stringify(init)}`);

  const CHUNK = 4 * 1024 * 1024;
  const file = fs.readFileSync(filePath);
  for (let i = 0, seg = 0; i < size; i += CHUNK, seg++) {
    const form = new FormData();
    form.append("segment_index", String(seg));
    form.append("media", new Blob([file.subarray(i, Math.min(i + CHUNK, size))]));
    const res = await fetch(`${API}/2/media/upload/${mediaId}/append`, {
      method: "POST",
      headers: { Authorization: `Bearer ${account.access_token}` },
      body: form,
    });
    if (!res.ok && res.status !== 204) {
      throw new Error(`X media append failed (${res.status}): ${await res.text()}`);
    }
  }

  let status = await apiJson(`/2/media/upload/${mediaId}/finalize`, account, { method: "POST" });
  for (let i = 0; i < 30 && status.data?.processing_info?.state &&
       !["succeeded", "failed"].includes(status.data.processing_info.state); i++) {
    await new Promise((r) => setTimeout(r, (status.data.processing_info.check_after_secs || 3) * 1000));
    status = await apiJson(`/2/media/upload?media_id=${mediaId}&command=STATUS`, account, {});
  }
  if (status.data?.processing_info?.state === "failed") {
    throw new Error(`X media processing failed: ${JSON.stringify(status.data.processing_info)}`);
  }

  // Tweets cap at 280 characters; keep the hook line and trim the rest.
  const text = caption.length > 275 ? `${caption.slice(0, 272).trimEnd()}…` : caption;
  const tweet = await apiJson("/2/tweets", account, {
    method: "POST",
    body: JSON.stringify({ text, media: { media_ids: [String(mediaId)] } }),
  });
  return String(tweet.data?.id || "");
}

// Returns a map of tweetId -> {views, likes, comments, shares}.
export async function fetchStats(account, tweetIds) {
  const stats = {};
  for (let i = 0; i < tweetIds.length; i += 100) {
    const chunk = tweetIds.slice(i, i + 100);
    const data = await apiJson(
      `/2/tweets?ids=${chunk.join(",")}&tweet.fields=public_metrics`,
      account,
      {}
    );
    for (const tweet of data.data || []) {
      const m = tweet.public_metrics || {};
      stats[String(tweet.id)] = {
        views: Number(m.impression_count || 0),
        likes: Number(m.like_count || 0),
        comments: Number(m.reply_count || 0),
        shares: Number(m.retweet_count || 0) + Number(m.quote_count || 0),
      };
    }
  }
  return stats;
}
