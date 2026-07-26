# Short-Form Content Manager

Turn one long-form video into a scheduled series of short clips, published automatically to **YouTube (Shorts)**, **Instagram (Reels)**, **TikTok**, **Facebook (Page Reels)** and **X**.

How it works:

1. **Connect accounts** — YouTube, Instagram and TikTok are connected via OAuth 2 from the web UI. Up to **5 accounts per platform** (configurable via `MAX_ACCOUNTS_PER_PLATFORM`). Each video is assigned to **one account per platform** — the least-used one — and *all* of that video's parts publish to that same account, spreading your videos across accounts round-robin style.
2. **Upload a long-form video** — it is split into **2-minute clips** with ffmpeg, or at **custom cut times**: enter cut points (`2:00, 5:30, 9:15`) to split at exact moments, or ranges (`0:30-2:10`, one per line) to pick exactly which sections become clips (anything between ranges is dropped). Keep clips under 3 minutes if you want YouTube to treat them as Shorts. Each clip gets **"Part 1", "Part 2", …** burned in at the top and **www.clint.build** at the bottom. Clips are rendered vertical (1080×1920) with a blurred background so they qualify as Shorts/Reels. If `OPENAI_API_KEY` is set, each clip also gets **auto-generated subtitles** — bold uppercase captions, up to 3 words at a time, with the spoken word highlighted in yellow (transcribed with Whisper, ~$0.006/audio-minute).
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
persistent volume **mounted at `/app/data`** (Railway: service → Volumes →
Add Volume; without it the queue and clips are lost on every deploy), and
set `BASE_URL` to the public URL the platform gives you (then register that
URL in each platform's OAuth settings).

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

**Facebook**
1. In a Meta developer app (the Instagram one or a new one), add the **Facebook Login** product with permissions `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`.
2. Add redirect URI `{BASE_URL}/auth/facebook/callback`.
3. Put the app ID/secret in `.env` (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`).
4. Clips publish as **Reels on Facebook Pages** — connecting adds every Page you manage as its own account (Page tokens don't expire).

**X (Twitter)**
1. Create an app at [developer.x.com](https://developer.x.com) with **OAuth 2.0** enabled (type: Web App, confidential client).
2. Add redirect URI `{BASE_URL}/auth/x/callback`.
3. Put the OAuth 2 client ID/secret in `.env` (`X_CLIENT_ID`, `X_CLIENT_SECRET`).
4. Clips publish as video posts; captions are trimmed to X's 280-character limit. The free API tier allows a limited number of posts per day.

## Configuration

All settings live in `.env` (see `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `ADMIN_PASSWORD` | *(empty)* | Dashboard password — **set this before going public** |
| `DELETE_ORIGINALS_AFTER_DAYS` | `7` | Delete original uploads N days after processing (0 = keep) |
| `PRUNE_VIDEOS_AFTER_DAYS` | `0` | Delete fully-published videos + clips after N days (0 = never) |
| `SITE_DOMAIN` | `www.clint.build` | Text burned into the bottom of every clip and appended to captions |
| `MAX_ACCOUNTS_PER_PLATFORM` | `5` | How many accounts can be connected per platform |
| `OPENAI_API_KEY` | *(empty)* | Enables Whisper auto-subtitles + AI titles/hashtags |
| `SUBTITLES` | `true` | Set `false` to disable subtitles while keeping the key |
| `GENERATE_METADATA` | `true` | Per-clip AI title/description/hashtags from the transcript |
| `OPENAI_CHAT_MODEL` | `gpt-4o-mini` | Model used for metadata generation |
| `CLIP_DURATION_SECONDS` | `120` | Length of each clip |
| `UPLOAD_INTERVAL_HOURS` | `3` | Gap between consecutive parts |
| `VERTICAL_FORMAT` | `true` | Render 1080×1920 vertical with blurred background |
| `VIDEO_CRF` | `20` | Encode quality (lower = better/bigger) |
| `VIDEO_PRESET` | `superfast` | x264 speed/quality trade-off (`ultrafast` … `medium`) |
| `VERTICAL_HEIGHT` | `1920` | Output height; `1280` (720p) encodes ~2× faster |
| `NORMALIZE_AUDIO` | `true` | Normalize loudness to the -14 LUFS platform target |
| `YOUTUBE_PRIVACY_STATUS` | `public` | `public`, `unlisted` or `private` |

## Operations

- **Login**: set `ADMIN_PASSWORD` and the dashboard (uploads, accounts, queue) sits behind a sign-in page; `/clips/*` stays public because Instagram fetches clip files by URL. Login attempts are rate-limited.
- **Processing queue**: videos encode one at a time (parallel ffmpeg runs would thrash a small server). If the server restarts mid-encode, interrupted videos are automatically re-queued on boot; failed videos get a Retry button.
- **Health**: `GET /healthz` (no auth) reports uptime and queue depth; the Dockerfile ships a matching `HEALTHCHECK`.
- **Disk**: originals are cleaned up after `DELETE_ORIGINALS_AFTER_DAYS`; deleting a video in the UI removes all its files. `PRUNE_VIDEOS_AFTER_DAYS` can additionally auto-delete old fully-published videos.

## Processing speed

Encoding is CPU-bound; a 2-minute 1080×1920 clip takes roughly 40–90 s on 4
shared vCPUs with the default settings. The levers, in order of impact:

1. **CPU cores** — encode time scales almost linearly with cores. On Railway,
   raise the service's vCPU allocation.
2. **`VERTICAL_HEIGHT=1280`** — 720p output, about twice as fast, still crisp
   on phones.
3. **`VIDEO_PRESET=ultrafast`** — another ~20 % on top of `superfast`, with a
   visible-but-small quality cost.

Transcription/AI-metadata calls all run in parallel before encoding starts, so
they add almost nothing to total wall time. 60 fps sources are capped to 30 fps
(halves encode time, no visible difference in feeds).

## Analytics

Views, likes, comments, shares and saves are pulled for every published post —
per video and per account — every 6 hours (or on demand with the **Refresh
metrics** button on the Analytics page). Sources: YouTube Data API statistics,
Instagram media insights, TikTok video queries.

Note: metrics need extra OAuth scopes (`instagram_business_manage_insights`,
TikTok `video.list`). Accounts connected before this feature must be
**reconnected once** from the Accounts page to grant them; YouTube accounts
are unaffected.

## Database: SQLite or Neon Postgres

By default everything is stored in SQLite (`data/app.db`). Set `DATABASE_URL`
to any Postgres connection string — e.g. a free [Neon](https://neon.tech)
database — and the app uses Postgres instead:

1. Create a project at neon.tech and copy the connection string
   (`postgresql://...neon.tech/neondb?sslmode=require`).
2. Set it as `DATABASE_URL` in your host's environment variables and redeploy.
   Tables are created automatically on first boot.

With Neon, accounts/queue/history survive redeploys **without** a disk volume.
Note: video files (originals + rendered clips) still live on disk, so keep the
volume mounted at `/app/data` — without it, clips that haven't published yet
are lost on redeploy even though their queue entries remain.

## How scheduling works

- When processing finishes, each clip gets a `scheduled_at` timestamp: part 1 = now, part N = now + (N−1) × 3h.
- A background worker runs every minute and publishes any due clip to each platform that has at least one connected account (up to 3 attempts per upload, 10 minutes apart).
- **Downtime-safe spacing**: if the server was down and several parts became overdue, they are automatically re-spaced (first one publishes immediately, each next one `UPLOAD_INTERVAL_HOURS` later) instead of all posting at once.
- On each platform, a video publishes to its **assigned account**: the first time a video needs to publish, the account with the fewest assigned videos is picked, and every part of that video sticks with it. Consecutive videos therefore rotate across your connected accounts.
- Everything is stored in SQLite (`data/app.db`), so the queue survives restarts. Keep the server running so scheduled uploads go out.

## Notes & limits

- When `OPENAI_API_KEY` is set, each clip's transcript is used to generate a unique hook title, a short description and 8-12 discovery hashtags; these become the YouTube title/description and the Instagram/TikTok captions. Without a key (or if generation fails), captions/titles fall back to `"{video title} - Part N/M"` plus the site domain. YouTube titles always get `#Shorts`.
- YouTube API default quota (10,000 units/day) allows ~6 video uploads per day — request more quota for heavy use.
- Instagram Reels must be ≤ 15 minutes; 2-minute clips are fine.
