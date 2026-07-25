# Short-Form Content Manager

Turn one long-form video into a scheduled series of short clips, published automatically to **YouTube (Shorts)**, **Instagram (Reels)** and **TikTok**.

How it works:

1. **Connect accounts** — YouTube, Instagram and TikTok are connected via OAuth 2 from the web UI. Up to **5 accounts per platform** (configurable via `MAX_ACCOUNTS_PER_PLATFORM`). Each video is assigned to **one account per platform** — the least-used one — and *all* of that video's parts publish to that same account, spreading your videos across accounts round-robin style.
2. **Upload a long-form video** — it is split into **2-minute clips** with ffmpeg. Each clip gets **"Part 1", "Part 2", …** burned in at the top and **www.clint.build** at the bottom. Clips are rendered vertical (1080×1920) with a blurred background so they qualify as Shorts/Reels.
3. **Automatic scheduling** — Part 1 publishes as soon as processing finishes; every following part publishes **3 hours** after the previous one, to *all* connected platforms.

## Requirements

- Node.js 18+
- ffmpeg + ffprobe on the PATH (or set `FFMPEG_PATH` / `FFPROBE_PATH`)

## Deployment: needs an always-on server (not Vercel/Netlify)

This app **cannot run on serverless platforms** like Vercel or Netlify. It needs a
persistent process and persistent disk, for three reasons:

1. The SQLite queue and rendered clips live on disk (`data/`) — serverless
   filesystems are read-only/ephemeral.
2. ffmpeg encodes 2-minute clips — not available in serverless functions and
   longer than their execution limits.
3. The 3-hour publishing schedule is driven by a background worker that must
   stay running between uploads.

Deploy it with the included `Dockerfile` on any container host — Railway,
Render, Fly.io, or a plain VPS:

```bash
docker build -t shortform-manager .
docker run -d --name shortform -p 3000:3000 \
  --env-file .env -v shortform-data:/app/data shortform-manager
```

On Railway/Render/Fly the Dockerfile is detected automatically; set the
environment variables from `.env.example` in their dashboard, attach a
persistent volume at `/app/data`, and set `BASE_URL` to the public URL the
platform gives you (then register that URL in each platform's OAuth settings).

## Setup

```bash
npm install
cp .env.example .env   # then fill it in
npm start              # open http://localhost:3000
```

### Getting API credentials

The server's **public URL** (`BASE_URL` in `.env`) must be registered as the OAuth redirect base with each platform, and must be reachable from the internet for Instagram publishing (Instagram downloads clips from `{BASE_URL}/clips/...`). During development a tunnel (ngrok, Cloudflare Tunnel) works well.

**YouTube**
1. Create a project at [console.cloud.google.com](https://console.cloud.google.com), enable **YouTube Data API v3**.
2. Create an OAuth client (type: Web application) and add redirect URI `{BASE_URL}/auth/youtube/callback`.
3. Put the client ID/secret in `.env` (`YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET`).

**Instagram**
1. Create an app at [developers.facebook.com](https://developers.facebook.com) and add the **Instagram API with Instagram Login** product. The Instagram account must be a Business or Creator account.
2. Add redirect URI `{BASE_URL}/auth/instagram/callback`.
3. Put the Instagram app ID/secret in `.env` (`INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`).

**TikTok**
1. Create an app at [developers.tiktok.com](https://developers.tiktok.com) with the **Content Posting API** product and `video.publish` scope.
2. Add redirect URI `{BASE_URL}/auth/tiktok/callback`.
3. Put the client key/secret in `.env` (`TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`).
4. Note: until your TikTok app passes their audit, posts can only be `SELF_ONLY` (private). Switch `TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE` once audited.

## Configuration

All settings live in `.env` (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `SITE_DOMAIN` | `www.clint.build` | Text burned into the bottom of every clip and appended to captions |
| `MAX_ACCOUNTS_PER_PLATFORM` | `5` | How many accounts can be connected per platform |
| `CLIP_DURATION_SECONDS` | `120` | Length of each clip |
| `UPLOAD_INTERVAL_HOURS` | `3` | Gap between consecutive parts |
| `VERTICAL_FORMAT` | `true` | Render 1080×1920 vertical with blurred background |
| `YOUTUBE_PRIVACY_STATUS` | `public` | `public`, `unlisted` or `private` |

## How scheduling works

- When processing finishes, each clip gets a `scheduled_at` timestamp: part 1 = now, part N = now + (N−1) × 3h.
- A background worker runs every minute and publishes any due clip to each platform that has at least one connected account (up to 3 attempts per upload, 10 minutes apart).
- On each platform, a video publishes to its **assigned account**: the first time a video needs to publish, the account with the fewest assigned videos is picked, and every part of that video sticks with it. Consecutive videos therefore rotate across your connected accounts.
- Everything is stored in SQLite (`data/app.db`), so the queue survives restarts. Keep the server running so scheduled uploads go out.

## Notes & limits

- Captions/titles are `"{video title} - Part N"` plus the site domain; YouTube titles also get `#Shorts`.
- YouTube API default quota (10,000 units/day) allows ~6 video uploads per day — request more quota for heavy use.
- Instagram Reels must be ≤ 15 minutes; 2-minute clips are fine.
