import fs from "node:fs";
import config from "../config.js";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const UPLOAD_URL =
  "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status";

export function isConfigured() {
  return Boolean(config.youtube.clientId && config.youtube.clientSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/youtube/callback`;
}

export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.youtube.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function handleCallback(code) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube token exchange failed: ${JSON.stringify(data)}`);

  let externalId = null;
  let displayName = "YouTube channel";
  try {
    const chRes = await fetch(
      "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const ch = await chRes.json();
    if (chRes.ok && ch.items?.length) {
      externalId = ch.items[0].id;
      displayName = ch.items[0].snippet?.title || displayName;
    }
  } catch {
    // Channel lookup is cosmetic; the upload scope is what matters.
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    externalId,
    displayName,
  };
}

export async function refresh(account) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: account.refresh_token,
      client_id: config.youtube.clientId,
      client_secret: config.youtube.clientSecret,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`YouTube token refresh failed: ${JSON.stringify(data)}`);
  return {
    accessToken: data.access_token,
    refreshToken: account.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

// Returns a map of videoId -> {views, likes, comments} for up to 50 ids/call.
export async function fetchStats(account, videoIds) {
  const stats = {};
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&maxResults=50`,
      { headers: { Authorization: `Bearer ${account.access_token}` } }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(`YouTube stats failed (${res.status}): ${JSON.stringify(data)}`);
    for (const item of data.items || []) {
      stats[item.id] = {
        views: Number(item.statistics?.viewCount || 0),
        likes: Number(item.statistics?.likeCount || 0),
        comments: Number(item.statistics?.commentCount || 0),
      };
    }
  }
  return stats;
}

export async function uploadClip(account, { filePath, title, description }) {
  const size = fs.statSync(filePath).size;
  const initRes = await fetch(UPLOAD_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
      "X-Upload-Content-Length": String(size),
      "X-Upload-Content-Type": "video/mp4",
    },
    body: JSON.stringify({
      snippet: { title, description, categoryId: "22" },
      status: {
        privacyStatus: config.youtube.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
    }),
  });
  if (!initRes.ok) {
    throw new Error(`YouTube upload init failed (${initRes.status}): ${await initRes.text()}`);
  }
  const sessionUrl = initRes.headers.get("location");
  if (!sessionUrl) throw new Error("YouTube upload init returned no session URL");

  const putRes = await fetch(sessionUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "video/mp4",
      "Content-Length": String(size),
    },
    body: fs.createReadStream(filePath),
    duplex: "half",
  });
  const result = await putRes.json().catch(() => ({}));
  if (!putRes.ok) {
    throw new Error(`YouTube upload failed (${putRes.status}): ${JSON.stringify(result)}`);
  }
  return result.id;
}
