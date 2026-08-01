import fs from "node:fs";
import config from "../config.js";

// Publishes clips as video posts on the member's LinkedIn feed via the
// versioned REST API (initialize upload -> PUT parts -> finalize -> post).

const OAUTH = "https://www.linkedin.com/oauth/v2";
const API = "https://api.linkedin.com";
const VERSION = "202501";

export function isConfigured() {
  return Boolean(config.linkedin.clientId && config.linkedin.clientSecret);
}

function redirectUri() {
  return `${config.baseUrl}/auth/linkedin/callback`;
}

export function authUrl(state) {
  // Company-page mode targets a dedicated app whose ONLY product is the
  // Community Management API (LinkedIn forbids mixing it with others), so
  // the member sign-in scopes don't exist there - org scopes only.
  const scope = config.linkedin.companyPages
    ? "r_organization_admin w_organization_social"
    : "openid profile w_member_social";
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.linkedin.clientId,
    redirect_uri: redirectUri(),
    scope,
    state,
  });
  return `${OAUTH}/authorization?${params}`;
}

export async function handleCallback(code) {
  const res = await fetch(`${OAUTH}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn token exchange failed: ${JSON.stringify(data)}`);

  const base = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || null,
    expiresAt: Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000,
  };

  // Company-page mode (dedicated Community Management API app): no member
  // sign-in scopes exist there, so skip the profile call entirely - every
  // organization the member administers becomes its own account, posting as
  // the Page (author urn:li:organization:{id}).
  if (config.linkedin.companyPages) {
    const aclRes = await fetch(
      `${API}/v2/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=50`,
      { headers: { Authorization: `Bearer ${data.access_token}` } }
    );
    const acls = await aclRes.json();
    if (!aclRes.ok) {
      throw new Error(`LinkedIn organization lookup failed: ${JSON.stringify(acls)}`);
    }
    const accounts = [];
    for (const el of acls.elements || []) {
      const orgId = String(el.organization || "").replace("urn:li:organization:", "");
      if (!orgId) continue;
      let name = `Company Page ${orgId}`;
      try {
        const orgRes = await fetch(`${API}/v2/organizations/${orgId}`, {
          headers: { Authorization: `Bearer ${data.access_token}` },
        });
        const org = await orgRes.json();
        if (orgRes.ok && org.localizedName) name = org.localizedName;
      } catch { /* cosmetic only */ }
      accounts.push({ ...base, externalId: `org:${orgId}`, displayName: `${name} (Page)` });
    }
    if (!accounts.length) {
      throw new Error(
        "No LinkedIn Company Pages found - the connecting member must be a super admin of the Page"
      );
    }
    console.log(`[auth] linkedin: ${accounts.length} company page(s)`);
    return { accounts };
  }

  const meRes = await fetch(`${API}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const me = await meRes.json();
  if (!meRes.ok || !me.sub) {
    throw new Error(`LinkedIn profile lookup failed: ${JSON.stringify(me)}`);
  }
  return { ...base, externalId: String(me.sub), displayName: me.name || "LinkedIn member" };
}

export async function refresh(account) {
  if (!account.refresh_token) {
    throw new Error("LinkedIn token expired - reconnect the account from the Accounts page");
  }
  const res = await fetch(`${OAUTH}/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      client_id: config.linkedin.clientId,
      client_secret: config.linkedin.clientSecret,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`LinkedIn token refresh failed: ${JSON.stringify(data)}`);
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || account.refresh_token,
    expiresAt: Date.now() + (data.expires_in || 60 * 24 * 3600) * 1000,
  };
}

async function api(path, account, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${account.access_token}`,
      "LinkedIn-Version": VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
      ...(options.body && typeof options.body === "string"
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers,
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) throw new Error(`LinkedIn ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  return { data, headers: res.headers };
}

export async function uploadClip(account, { filePath, title, caption }) {
  const owner = String(account.external_id).startsWith("org:")
    ? `urn:li:organization:${String(account.external_id).slice(4)}`
    : `urn:li:person:${account.external_id}`;
  const size = fs.statSync(filePath).size;

  const { data: init } = await api("/rest/videos?action=initializeUpload", account, {
    method: "POST",
    body: JSON.stringify({
      initializeUploadRequest: {
        owner,
        fileSizeBytes: size,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  const { video: videoUrn, uploadInstructions, uploadToken } = init.value;

  const file = fs.readFileSync(filePath);
  const etags = [];
  for (const part of uploadInstructions) {
    const chunk = file.subarray(part.firstByte, part.lastByte + 1);
    const putRes = await fetch(part.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      body: chunk,
    });
    if (!putRes.ok) {
      throw new Error(`LinkedIn video part upload failed (${putRes.status})`);
    }
    etags.push(putRes.headers.get("etag"));
  }

  await api("/rest/videos?action=finalizeUpload", account, {
    method: "POST",
    body: JSON.stringify({
      finalizeUploadRequest: {
        video: videoUrn,
        uploadToken: uploadToken || "",
        uploadedPartIds: etags,
      },
    }),
  });

  // Wait for processing before creating the post.
  for (let i = 0; i < 30; i++) {
    const { data: status } = await api(`/rest/videos/${encodeURIComponent(videoUrn)}`, account);
    if (status.status === "AVAILABLE") break;
    if (status.status === "PROCESSING_FAILED") {
      throw new Error("LinkedIn video processing failed");
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  const { headers } = await api("/rest/posts", account, {
    method: "POST",
    body: JSON.stringify({
      author: owner,
      commentary: (caption || "").slice(0, 2900),
      visibility: "PUBLIC",
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { id: videoUrn, title: (title || "").slice(0, 200) } },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    }),
  });
  return headers.get("x-restli-id") || videoUrn;
}

// Post analytics for member (personal) posts aren't exposed by LinkedIn's
// API, so there is intentionally no fetchStats here - the metrics job
// skips platforms without one.
