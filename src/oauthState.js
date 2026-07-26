import crypto from "node:crypto";

// Short-lived anti-CSRF state tokens for the OAuth flows.
const states = new Map();
const TTL_MS = 10 * 60 * 1000;

export function createState(platform, data = null) {
  const state = crypto.randomBytes(24).toString("hex");
  states.set(state, { platform, data, expires: Date.now() + TTL_MS });
  return state;
}

// Returns { ok, data } - data carries flow extras like the PKCE verifier.
export function consumeState(state, platform) {
  const entry = states.get(state);
  states.delete(state);
  for (const [key, value] of states) {
    if (value.expires < Date.now()) states.delete(key);
  }
  const ok = Boolean(entry && entry.platform === platform && entry.expires >= Date.now());
  return { ok, data: ok ? entry.data : null };
}
