/* Per-platform setup guides rendered on the Settings page. Content is
   data-driven; redirect URIs and env status come from /api/settings. */

import { icons, esc, PLATFORMS } from "./common.js";

const copyBtn = (text) =>
  `<button class="icon-btn copy-btn" title="Copy" data-copy="${esc(text)}">${icons.copy}</button>`;

const code = (text) => `<code>${esc(text)}</code>${copyBtn(text)}`;

function guide(key, s, { env, where, steps, gotchas, notes }) {
  const uri = s.server.redirectUris[key];
  const configured = s.server.credentialsConfigured[key];
  return `
  <details class="guide" id="guide-${key}">
    <summary>
      <span class="platform-logo ${key}">${icons[key]}</span>
      <span class="guide-name">${PLATFORMS[key]}</span>
      <span class="badge ${configured ? "done" : ""}">${configured ? "credentials set" : "not set up"}</span>
    </summary>
    <div class="guide-body">
      <div class="guide-facts">
        <div><span class="k">Developer portal</span><span>${where}</span></div>
        <div><span class="k">Redirect URI to register</span><span>${code(uri)}</span></div>
        <div><span class="k">Railway variables</span><span>${env.map((e) => code(e)).join(" ")}</span></div>
      </div>
      <ol class="guide-steps">${steps.map((st) => `<li>${st}</li>`).join("")}</ol>
      ${notes ? `<div class="callout info">${icons.alert}<span>${notes}</span></div>` : ""}
      ${gotchas?.length ? `
        <div class="guide-gotchas">
          <div class="card-title" style="margin-bottom:8px">If it fails</div>
          <ul>${gotchas.map((g) => `<li>${g}</li>`).join("")}</ul>
        </div>` : ""}
    </div>
  </details>`;
}

export function buildGuides(s) {
  const base = s.server.baseUrl;
  const hook = s.server.metaWebhook || { callbackUrl: `${base}/webhooks/meta`, verifyToken: "shortform-verify" };
  const webhookStep =
    `If the setup flow asks for <strong>Webhooks</strong> (a "Callback URL" and "Verify token"), use ` +
    `Callback URL ${code(hook.callbackUrl)} and Verify token ${code(hook.verifyToken)}. ` +
    `This tool doesn't consume webhook events — the server just answers Meta's validation ping. ` +
    `You can skip webhook <em>field subscriptions</em> entirely.`;
  const webhookGotcha =
    `<strong>"The callback URL or verify token couldn't be validated"</strong> → the server must be ` +
    `deployed and reachable first (Meta pings the URL when you hit save), the Callback URL must be exactly ` +
    `${code(hook.callbackUrl)}, and the token you type must match <code>META_VERIFY_TOKEN</code> ` +
    `(current value: ${code(hook.verifyToken)}).`;

  const guides = [
    guide("youtube", s, {
      env: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
      where: `<a href="https://console.cloud.google.com" target="_blank" rel="noopener">console.cloud.google.com</a>`,
      steps: [
        `Sign in with the Google account you'll manage from and create a <strong>new project</strong> (top bar → project picker → New Project).`,
        `In the left menu: <strong>APIs &amp; Services → Library</strong>, search for <strong>"YouTube Data API v3"</strong> and click <strong>Enable</strong>.`,
        `Go to <strong>APIs &amp; Services → OAuth consent screen</strong>: choose <strong>External</strong>, fill in the app name, your email, and add <code>${esc(base.replace(/^https?:\/\//, ""))}</code> under authorized domains if asked. Use <a href="/terms" target="_blank">/terms</a> and <a href="/privacy" target="_blank">/privacy</a> on this server as the terms/privacy URLs.`,
        `Under <strong>Scopes</strong> you can skip adding scopes manually (the app requests them at connect time). Under <strong>Test users</strong>, add every Google account whose YouTube channels you'll connect.`,
        `<strong>Important:</strong> after testing works, go back to the OAuth consent screen and click <strong>Publish app</strong> (status "In production"). In "Testing" status Google kills tokens after 7 days and uploads start failing with 401s.`,
        `Go to <strong>APIs &amp; Services → Credentials → Create credentials → OAuth client ID</strong>. Application type: <strong>Web application</strong>. Under "Authorized redirect URIs" paste the redirect URI above, exactly.`,
        `Copy the <strong>Client ID</strong> and <strong>Client secret</strong> into the Railway variables above, redeploy, then connect from the Accounts page.`,
        `Each Google account you connect must actually <strong>have a YouTube channel</strong> — open youtube.com with it once and create the channel if prompted.`,
      ],
      gotchas: [
        `<strong>401 Unauthorized on uploads days after connecting</strong> → the consent screen is still in "Testing"; publish the app and reconnect.`,
        `<strong>redirect_uri_mismatch</strong> → the URI in Google must match the one above character-for-character (https, no trailing slash).`,
        `<strong>Account shows as "YouTube channel"</strong> instead of your channel name → the Google account has no channel; create one and reconnect.`,
        `<strong>Uploads stop after ~6 videos/day</strong> → default API quota (10,000 units) is exhausted; request a quota increase in Google Cloud → APIs → YouTube Data API → Quotas.`,
      ],
    }),

    guide("instagram", s, {
      env: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
      where: `<a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a>`,
      steps: [
        `Your Instagram account must be a <strong>Professional account</strong> (Business or Creator): Instagram app → Settings → Account type and tools → Switch to professional account.`,
        `At developers.facebook.com: <strong>My Apps → Create App</strong> → use case <strong>Other</strong> → type <strong>Business</strong>.`,
        `In the app dashboard, <strong>Add product → Instagram</strong>, then choose <strong>"API setup with Instagram login"</strong> (NOT "with Facebook login" — this tool uses the Instagram-login flavor).`,
        `In that Instagram section, open <strong>Business login settings</strong> and add the redirect URI above under "OAuth redirect URIs".`,
        webhookStep,
        `Copy the <strong>Instagram App ID</strong> and <strong>Instagram App Secret</strong> shown in the Instagram section — these are <strong>different values</strong> from the Facebook App ID/Secret on the Settings→Basic page. Put them in the Railway variables above and redeploy.`,
        `While the app is in Development mode, add your Instagram account as a tester: <strong>App roles → Roles → Add People → Instagram Tester</strong>, enter the IG username.`,
        `Accept the invite from the Instagram side: instagram.com → Settings → <strong>Apps and websites → Tester invites</strong> → Accept.`,
        `Connect from the Accounts page. Repeat the tester steps for each additional Instagram account (up to 5).`,
      ],
      gotchas: [
        `<strong>"Invalid platform app" / invalid client</strong> → you pasted the Facebook App ID instead of the Instagram-specific one.`,
        `<strong>"Invalid redirect_uri" that comes and goes</strong> → an Instagram cookie-session quirk, not a real URI problem. The connect flow forces a fresh Instagram login to avoid it; if it still appears, retry once or use a private/incognito window.`,
        `<strong>"Error validating verification code … redirect_uri is identical"</strong> → despite the wording, usually a dead one-time code, and a simple retry of Connect fixes it. If it fails every time: the Business login settings must list this exact URI ${code(s.server.redirectUris.instagram)} as the ONLY entry — delete any variants (http://, trailing slash, old domains) you added while testing.`,
        `<strong>Login says the app isn't available</strong> → tester invite not accepted, or the IG account isn't Business/Creator.`,
        `<strong>Publishing fails fetching the video</strong> → BASE_URL must be this server's public URL; Instagram downloads clips from <code>${esc(base)}/clips/…</code>.`,
        webhookGotcha,
      ],
    }),

    guide("tiktok", s, {
      env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET", "TIKTOK_PRIVACY_LEVEL", "TIKTOK_SCOPES"],
      where: `<a href="https://developers.tiktok.com" target="_blank" rel="noopener">developers.tiktok.com</a>`,
      steps: [
        `Create a developer account and an <strong>app</strong> at developers.tiktok.com (Manage apps → Connect an app).`,
        `Fill the app basics. For the required URLs, use this server's <a href="/terms" target="_blank">/terms</a> and <a href="/privacy" target="_blank">/privacy</a> pages.`,
        `<strong>Verify your domain</strong>: in the app's URL properties, choose URL prefix <code>${esc(base)}/</code>, download the verification .txt file TikTok gives you and send it to the operator (files in <code>public/verification/</code> are served from the site root), then click Verify.`,
        `Add the products: <strong>Login Kit</strong> and <strong>Content Posting API</strong>. In Content Posting API, enable <strong>Direct Post</strong>.`,
        `In the app's <strong>Scopes</strong> section make sure these are listed: <code>user.info.basic</code>, <code>video.publish</code>, and <code>video.list</code> (video.list powers view-count analytics; if your app can't get it, set <code>TIKTOK_SCOPES=user.info.basic,video.publish</code> instead).`,
        `Add the redirect URI above in the Login Kit settings, exactly.`,
        `Copy the <strong>Client key</strong> and <strong>Client secret</strong> from the app credentials into the Railway variables and redeploy. Copy both from the same screen — sandbox and production have different pairs.`,
        `While the app is <strong>unaudited</strong>: keep <code>TIKTOK_PRIVACY_LEVEL=SELF_ONLY</code> and set the TikTok account itself to <strong>Private</strong> (TikTok app → Settings → Privacy). Posts will be visible only to you — that's TikTok's rule until audit.`,
        `Submit the app for <strong>audit/review</strong> in the portal. Once approved, set <code>TIKTOK_PRIVACY_LEVEL=PUBLIC_TO_EVERYONE</code>, make the account public again, and redeploy.`,
      ],
      gotchas: [
        `<strong>"correct the following: scope"</strong> on the login screen → the app hasn't been granted one of the requested scopes (usually video.list) — grant it in the portal or trim <code>TIKTOK_SCOPES</code>.`,
        `<strong>invalid_client "Client key or secret is incorrect"</strong> → key/secret pair mismatch (sandbox vs production) or stray whitespace; re-copy both from one screen.`,
        `<strong>unaudited_client_can_only_post_to_private_accounts</strong> → set the TikTok account to Private and privacy level to SELF_ONLY until the audit passes.`,
        `<strong>Login blocked entirely</strong> → in sandbox mode, add your TikTok account under the app's target users.`,
      ],
    }),

    guide("facebook", s, {
      env: ["FACEBOOK_APP_ID", "FACEBOOK_APP_SECRET", "FACEBOOK_CONFIG_ID"],
      where: `<a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a>`,
      steps: [
        `<strong>How Facebook is different:</strong> clips post to <strong>Pages</strong>, not profiles, and ONE login imports every Page that account can manage — each Page becomes its own slot here. So unlike Instagram/Threads you never add testers per account: instead, share every Page to one Facebook account (Page → Settings → <strong>Page access</strong> → Add, full control) and connect once with that account.`,
        `<strong>Create a dedicated Business-type app for Facebook</strong> (separate from the Instagram one; the Pages permissions are only available to Business apps — a Consumer app gets "Invalid Scopes"). Logged in as the account that will do the connecting: My Apps → Create app → use case <strong>Other</strong> → type <strong>Business</strong>; if a business-portfolio dropdown appears, select yours.`,
        `<strong>Add product → Facebook Login for Business</strong>, then in its <strong>Settings</strong>: <strong>Client OAuth login</strong> and <strong>Web OAuth login</strong> both ON, paste the redirect URI above into <strong>Valid OAuth Redirect URIs</strong> (the <em>Redirect URI Validator</em> box tells you if it's accepted), Save.`,
        `<strong>Facebook Login for Business → Configurations → Create configuration</strong>: login variation <strong>General</strong>, access token type <strong>User access token</strong> (NOT System-user — that type crashes the login for everyone), permissions <code>pages_show_list</code>, <code>pages_manage_posts</code>, <code>pages_read_engagement</code>. Save, then copy the row's <strong>Configuration ID</strong> (a long number — NOT the App ID) into <code>FACEBOOK_CONFIG_ID</code>.`,
        `<strong>Complete App settings → Basic in one visit</strong> — an incomplete profile gets login suspended with "Feature Unavailable": App Domains ${code(base.replace(/^https?:\/\//, ""))}, the <a href="/privacy" target="_blank">/privacy</a> and <a href="/terms" target="_blank">/terms</a> URLs, data-deletion URL (privacy URL works), a category, a 1024×1024 app icon, and at the bottom <strong>Add Platform → Website</strong> with Site URL ${code(base + "/")}. Save.`,
        webhookStep,
        `Copy the <strong>App ID</strong> and <strong>App Secret</strong> from App settings → Basic into the Railway variables and redeploy. <code>/healthz</code> shows <code>facebookLogin: "config_id (…)"</code> when the running deployment has all three values.`,
        `<strong>Keep the app in Development mode — permanently.</strong> The app creator can grant all Pages permissions there with no App Review. Publishing requires Business Verification + App Review and breaks login with generic errors until both pass.`,
        `Connect from the Accounts page, logging in as the app-creator account. Every Page it manages is imported as its own account (up to the 5 cap) — disconnect any you don't want posting.`,
      ],
      gotchas: [
        `<strong>"The domain of this URL isn't included in the app's domains"</strong> → App settings → Basic → <strong>App Domains</strong>: add ${code(base.replace(/^https?:\/\//, ""))} (domain only, no https:// or path), then at the bottom of the same page <strong>Add Platform → Website</strong> with Site URL ${code(base + "/")}, and Save.`,
        `<strong>"Invalid parameter: config_id is required"</strong> → <code>FACEBOOK_CONFIG_ID</code> is missing from the running deployment (check <code>/healthz</code>), or it holds the App ID instead of the Configuration ID.`,
        `<strong>"Invalid Scopes: pages_manage_posts…"</strong> → the app is Consumer-type; Pages permissions need a Business-type app. Recreate it per step 2.`,
        `<strong>"App not active"</strong> → the Facebook account in the dialog has no role on the app; log in as the app-creator account.`,
        `<strong>"Feature Unavailable: Facebook Login is currently unavailable"</strong> → the Basic profile is incomplete (icon, category, privacy/terms/data-deletion URLs); complete it, save, and wait — the suspension can take hours to lift. A fresh, fully-filled app is often faster than waiting.`,
        `<strong>Generic "Sorry, something went wrong" on the login dialog</strong> → in order of likelihood: the app is Live (switch to Development); the configuration's token type is System-user instead of User; the logged-in account has no role on the app; no business portfolio connected. If everything checks out, the app's login state is poisoned — a fresh Business app set up in one pass fixes it.`,
        `<strong>"No Facebook Pages found"</strong> → the logged-in user doesn't manage any Page; share the Pages to it first (Page → Settings → Page access).`,
        `<strong>New Pages don't show up</strong> → reconnect and make sure the new Page is CHECKED in Facebook's picker. If the picker doesn't list it: facebook.com → Settings → <strong>Apps and websites</strong> → this app → View and edit → add the Page there, then reconnect.`,
        `<strong>Reel upload fails fetching the video</strong> → BASE_URL must be publicly reachable; Facebook pulls the clip from <code>${esc(base)}/clips/…</code>.`,
        webhookGotcha,
      ],
    }),

    guide("x", s, {
      env: ["X_CLIENT_ID", "X_CLIENT_SECRET"],
      where: `<a href="https://developer.x.com" target="_blank" rel="noopener">developer.x.com</a>`,
      steps: [
        `Sign up for a developer account (Free tier) at developer.x.com with any X account, then create a <strong>Project</strong> and an <strong>App inside the project</strong> — standalone apps don't get the v2 API this tool uses.`,
        `In the app: <strong>Settings → User authentication settings → Set up</strong>.`,
        `App permissions: <strong>Read and write</strong>. Type of App: <strong>"Web App, Automated App or Bot"</strong> (confidential client — required; the Native/Public type will not work).`,
        `Callback URI: paste the redirect URI above. Website URL: <code>https://www.clint.build</code> (any valid URL).`,
        `Save — X shows the <strong>OAuth 2.0 Client ID and Client Secret</strong> once. Copy them immediately into the Railway variables and redeploy. Do NOT use the "API Key &amp; Secret" or "Bearer Token" shown elsewhere — those are the old v1.1 credentials.`,
        `Connect from the Accounts page; any X account can log in through the flow (not just the developer one).`,
      ],
      notes: `X meters API usage in <strong>credits</strong>: the free tier covers only a handful of video posts before returning <em>402 credits depleted</em>. For real volume, upgrade the project to the paid Basic tier under the developer portal's billing page.`,
      gotchas: [
        `<strong>402 "credits depleted"</strong> → free-tier allowance exhausted; wait for the monthly reset or upgrade.`,
        `<strong>unauthorized_client at login</strong> → the app type isn't confidential/Web App; redo user authentication settings.`,
        `<strong>Changed app permissions later?</strong> → disconnect and reconnect the account; existing tokens keep their old permissions.`,
      ],
    }),

    guide("threads", s, {
      env: ["THREADS_APP_ID", "THREADS_APP_SECRET"],
      where: `<a href="https://developers.facebook.com" target="_blank" rel="noopener">developers.facebook.com</a>`,
      steps: [
        `In a Meta developer app (a new one or your existing Business app), add the <strong>Threads API</strong> use case/product.`,
        `In the Threads settings, add the redirect URI above under the OAuth redirect URIs.`,
        webhookStep,
        `Copy the <strong>Threads App ID</strong> and <strong>Threads App Secret</strong> from the Threads use-case settings — like Instagram, these are their own pair, separate from the Facebook App ID/Secret. Set the Railway variables and redeploy.`,
        `While the app is in Development mode, add your Threads profile as a tester (App roles), then accept the invite from Threads: threads.net → Settings → <strong>Website permissions → Invites</strong>.`,
        `Connect from the Accounts page. Captions are automatically trimmed to Threads' 500-character limit.`,
      ],
      gotchas: [
        `<strong>Login says app not available</strong> → tester invite not accepted on the Threads side.`,
        `<strong>Publish fails fetching video</strong> → clips are ingested from <code>${esc(base)}/clips/…</code>; BASE_URL must be public.`,
        webhookGotcha,
      ],
    }),

    guide("pinterest", s, {
      env: ["PINTEREST_APP_ID", "PINTEREST_APP_SECRET"],
      where: `<a href="https://developers.pinterest.com" target="_blank" rel="noopener">developers.pinterest.com</a>`,
      steps: [
        `Use (or create) a Pinterest <strong>business account</strong> — free conversion at pinterest.com/business/convert; needed for API access and analytics.`,
        `At developers.pinterest.com: <strong>My apps → Create app</strong>. New apps start with <strong>Trial access</strong>, which is enough to connect and post to your own account.`,
        `In the app settings, add the redirect URI above.`,
        `Copy the <strong>App ID</strong> and <strong>App secret key</strong> into the Railway variables and redeploy.`,
        `Connect from the Accounts page and approve the boards/pins scopes.`,
        `Clips post as <strong>video Pins</strong> to your first board — or the tool auto-creates a board called <strong>"Short Clips"</strong> if you have none. Each Pin links back to <code>${esc("https://" + (s.branding?.siteDomain || "www.clint.build"))}</code>.`,
        `When you outgrow trial limits, request <strong>Standard access</strong> in the portal (short form, usually quick).`,
      ],
      gotchas: [
        `<strong>403 on posting</strong> → trial access not yet granted or the app lacks pins:write; check the app's scopes/access level.`,
        `<strong>No analytics numbers</strong> → Pin analytics require the business account to own the Pin and can lag ~24h after posting.`,
      ],
    }),

    guide("linkedin", s, {
      env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
      where: `<a href="https://developer.linkedin.com" target="_blank" rel="noopener">developer.linkedin.com</a>`,
      steps: [
        `Create an app at developer.linkedin.com → <strong>Create app</strong>. It must be associated with a <strong>LinkedIn Page</strong> (create a free company Page if you don't have one; this is just the app's identity — posts go to your personal feed).`,
        `In the app's <strong>Products</strong> tab, add <strong>"Share on LinkedIn"</strong> and <strong>"Sign In with LinkedIn using OpenID Connect"</strong> (both self-serve).`,
        `In the <strong>Auth</strong> tab, add the redirect URI above under "Authorized redirect URLs".`,
        `Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> from the Auth tab into the Railway variables and redeploy.`,
        `Connect from the Accounts page. Clips post as video posts on the connected member's personal feed.`,
      ],
      notes: `Standard LinkedIn apps don't get refresh tokens, so the connection expires roughly every <strong>60 days</strong> — reconnect from the Accounts page when posts start failing with auth errors. LinkedIn also doesn't expose analytics for personal posts, so this platform shows no numbers on the Analytics page.`,
      gotchas: [
        `<strong>unauthorized_scope at login</strong> → the two products above aren't added/approved on the app yet.`,
        `<strong>Auth errors after ~2 months</strong> → token expired by design; reconnect the account.`,
      ],
    }),
  ];

  return `
    <div class="card mb-16" id="setup-guides">
      <div class="card-title">Platform setup guides
        <span class="hint">click a platform for exact step-by-step instructions</span>
      </div>
      ${guides.join("")}
    </div>`;
}
