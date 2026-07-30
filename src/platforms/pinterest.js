import fs from "node:fs";
import config from "../config.js";

// Publishes clips as video Pins via the Pinterest API v5. Pins live on a
// board: the account's first board is used, or a "Short Clips" board is
// created automatically.

const API = "https://api.pinterest.com/v5";

export function isConfigured() {
  return Boolean(config.pinterest.appId && config.pinterest.appSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/pinterest/callback`;
}

function basicAuth() {
  return `Basic ${Buffer.from(`${config.pinterest.appId}:${config.pinterest.appSecret}`).toString("base64")}`;
}

export function authUrl(state) {
  const params = new URLSearchParams({
    client_id: config.pinterest.appId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "boards:read,boards:write,pins:read,pins:write,user_accounts:read",
    state,
  });
  return `https://www.pinterest.com/oauth/?${params}`;
}

async function tokenRequest(body) {
  const res = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: basicAuth(),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Pinterest token request failed: ${JSON.stringify(data)}`);
  return data;
}

export async function handleCallback(code) {
  const data = await tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(),
  });

  let externalId = null;
  let displayName = "Pinterest account";
  try {
    const meRes = await fetch(`${API}/user_account`, {
      headers: { Authorization: `Bearer ${data.access_token}` },
    });
    const me = await meRes.json();
    if (meRes.ok) {
      externalId = String(me.id || me.username || "");
      displayName = me.username ? `@${me.username}` : displayName;
    }
  } catch {
    // Cosmetic only.
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
  const data = await tokenRequest({
    grant_type: "refresh_token",
    refresh_token: account.refresh_token,
  });
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };
}

async function api(path, account, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Pinterest ${path} failed (${res.status}): ${JSON.stringify(data)}`);
  return data;
}

async function pickBoard(account) {
  const boards = await api("/boards?page_size=25", account);
  if (boards.items?.length) return boards.items[0].id;
  const created = await api("/boards", account, {
    method: "POST",
    body: JSON.stringify({ name: "Short Clips", privacy: "PUBLIC" }),
  });
  return created.id;
}

export async function uploadClip(account, { filePath, title, caption }) {
  const boardId = await pickBoard(account);

  // 1) Register the upload, 2) push the file to the returned S3 form,
  // 3) wait for processing, 4) create the Pin.
  const media = await api("/media", account, {
    method: "POST",
    body: JSON.stringify({ media_type: "video" }),
  });

  const form = new FormData();
  for (const [key, value] of Object.entries(media.upload_parameters || {})) {
    form.append(key, value);
  }
  form.append("file", new Blob([fs.readFileSync(filePath)], { type: "video/mp4" }));
  const uploadRes = await fetch(media.upload_url, { method: "POST", body: form });
  if (!uploadRes.ok && uploadRes.status !== 204) {
    throw new Error(`Pinterest media upload failed (${uploadRes.status}): ${await uploadRes.text()}`);
  }

  let status = "registered";
  for (let i = 0; i < 30 && status !== "succeeded"; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const check = await api(`/media/${media.media_id}`, account);
    status = check.status;
    if (status === "failed") throw new Error("Pinterest media processing failed");
  }
  if (status !== "succeeded") throw new Error("Pinterest media processing timed out");

  const pin = await api("/pins", account, {
    method: "POST",
    body: JSON.stringify({
      board_id: boardId,
      title: (title || "").replace(/#\S+/g, "").trim().slice(0, 100),
      description: (caption || "").slice(0, 780),
      link: `https://${config.siteDomain.replace(/^https?:\/\//, "")}`,
      media_source: { source_type: "video_id", media_id: media.media_id },
    }),
  });
  return String(pin.id);
}

// Returns a map of pinId -> {views, likes, saves}. Analytics require a
// Pinterest business account; failures are skipped quietly.
export async function fetchStats(account, pinIds) {
  const stats = {};
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - 89 * 86400000).toISOString().slice(0, 10);
  for (const id of pinIds) {
    try {
      const data = await api(
        `/pins/${id}/analytics?start_date=${start}&end_date=${end}` +
          `&metric_types=IMPRESSION,SAVE,PIN_CLICK`,
        account
      );
      const summary = data.all?.summary_metrics || {};
      stats[id] = {
        views: Number(summary.IMPRESSION || 0),
        saves: Number(summary.SAVE || 0),
        likes: 0,
        comments: 0,
        shares: Number(summary.PIN_CLICK || 0),
      };
    } catch {
      // Analytics unavailable (non-business account) - skip this pin.
    }
  }
  return stats;
}
