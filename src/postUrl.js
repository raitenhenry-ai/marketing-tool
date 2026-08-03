// Builds the public link to a published post from what the platforms give
// us. public_post_id holds a full permalink where the platform provides one
// (Instagram/Threads) or the public video id (TikTok); platform_video_id
// holds the id returned at publish time.
export function postUrl(u) {
  const id = u.platform_video_id;
  const pub = u.public_post_id;
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  switch (u.platform) {
    case "youtube":
      return id ? `https://youtu.be/${encodeURIComponent(id)}` : null;
    case "facebook":
      return id ? `https://www.facebook.com/reel/${encodeURIComponent(id)}` : null;
    case "x":
      // /i/status resolves without needing the handle.
      return id ? `https://x.com/i/status/${encodeURIComponent(id)}` : null;
    case "pinterest":
      return id ? `https://www.pinterest.com/pin/${encodeURIComponent(id)}/` : null;
    case "linkedin":
      return id ? `https://www.linkedin.com/feed/update/${encodeURIComponent(id)}/` : null;
    case "tiktok": {
      if (!pub) return null;
      const handle = String(u.account_name || u.accountName || "").replace(/^@/, "");
      return handle ? `https://www.tiktok.com/@${handle}/video/${encodeURIComponent(pub)}` : null;
    }
    default:
      // instagram/threads permalinks arrive via public_post_id (handled above).
      return null;
  }
}
