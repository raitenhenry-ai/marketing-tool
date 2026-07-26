import fs from "node:fs";
import config from "../config.js";

const TOKEN_URL = "https://open.tiktokapis.com/v2/oauth/token/";
const INIT_URL = "https://open.tiktokapis.com/v2/post/publish/video/init/";

export function isConfigured() {
  return Boolean(config.tiktok.clientKey && config.tiktok.clientSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/tiktok/callback`;
}

export function authUrl(state) {
  const params = new URLSearchParams({
    client_key: config.tiktok.clientKey,
    response_type: "code",
    scope: "user.info.basic,video.publish,video.list",
    redirect_uri: redirectUri(),
    state,
  });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`TikTok token request failed: ${JSON.stringify(data)}`);
  }
  return data;
}

export async function handleCallback(code) {
  const data = await tokenRequest({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    code,
    grant_type: "authorization_code",
    redirect_uri: redirectUri(),
  });

  let displayName = "TikTok account";
  try {
    const meRes = await fetch(
      "https://open.tiktokapis.com/v2/user/info/?fields=display_name",
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const me = await meRes.json();
    if (me.data?.user?.display_name) displayName = me.data.user.display_name;
  } catch {
    // Cosmetic only.
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 86400) * 1000,
    externalId: data.open_id || null,
    displayName,
  };
}

export async function refresh(account) {
  const data = await tokenRequest({
    client_key: config.tiktok.clientKey,
    client_secret: config.tiktok.clientSecret,
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 86400) * 1000,
  };
}

// The publish flow returns an internal publish_id; the public video id only
// exists once TikTok finishes processing. Returns the public id or null.
export async function resolvePostId(account, publishId) {
  const res = await fetch("https://open.tiktokapis.com/v2/post/publish/status/fetch/", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ publish_id: publishId }),
  });
  const data = await res.json();
  if (!res.ok || data.error?.code !== "ok") return null;
  return data.data?.publicaly_available_post_id?.[0]
    ? String(data.data.publicaly_available_post_id[0])
    : null;
}

// Returns a map of videoId -> {views, likes, comments, shares} (<=20 ids/call).
export async function fetchStats(account, videoIds) {
  const stats = {};
  for (let i = 0; i < videoIds.length; i += 20) {
    const chunk = videoIds.slice(i, i + 20);
    const res = await fetch(
      "https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${account.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filters: { video_ids: chunk } }),
      }
    );
    const data = await res.json();
    if (!res.ok || data.error?.code !== "ok") {
      throw new Error(`TikTok stats failed: ${JSON.stringify(data.error || data)}`);
    }
    for (const v of data.data?.videos || []) {
      stats[String(v.id)] = {
        views: Number(v.view_count || 0),
        likes: Number(v.like_count || 0),
        comments: Number(v.comment_count || 0),
        shares: Number(v.share_count || 0),
      };
    }
  }
  return stats;
}

export async function uploadClip(account, { filePath, caption, title }) {
  const text = caption || title || "";
  const size = fs.statSync(filePath).size;

  // TikTok chunk rules: every chunk except the last must be 5MB-64MB, and the
  // final chunk absorbs the remainder. Files under 64MB go up as one chunk.
  const CHUNK = 50 * 1024 * 1024;
  const singleChunk = size <= 64 * 1024 * 1024;
  const chunkSize = singleChunk ? size : CHUNK;
  const totalChunks = singleChunk ? 1 : Math.floor(size / CHUNK);

  const initRes = await fetch(INIT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      post_info: {
        title: text,
        privacy_level: config.tiktok.privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
      },
      source_info: {
        source: "FILE_UPLOAD",
        video_size: size,
        chunk_size: chunkSize,
        total_chunk_count: totalChunks,
      },
    }),
  });
  const init = await initRes.json();
  if (!initRes.ok || init.error?.code !== "ok") {
    throw new Error(`TikTok upload init failed: ${JSON.stringify(init)}`);
  }
  const { upload_url: uploadUrl, publish_id: publishId } = init.data;

  const file = fs.readFileSync(filePath);
  for (let i = 0; i < totalChunks; i++) {
    const start = i * chunkSize;
    const isLast = i === totalChunks - 1;
    const end = isLast ? size - 1 : start + chunkSize - 1;
    const body = file.subarray(start, end + 1);
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(body.length),
        "Content-Range": `bytes ${start}-${end}/${size}`,
      },
      body,
    });
    if (!putRes.ok && putRes.status !== 201) {
      throw new Error(`TikTok chunk upload failed (${putRes.status}): ${await putRes.text()}`);
    }
  }

  return publishId;
}
