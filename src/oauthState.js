import crypto from "node:crypto";

// Short-lived anti-CSRF state tokens for the OAuth flows.
const states = new Map();
const TTL_MS = 10 * 60 * 1000;

export function createState(platform) {
  const state = crypto.randomBytes(24).toString("hex");
  states.set(state, { platform, expires: Date.now() + TTL_MS });
  return state;
}

export function consumeState(state, platform) {
  const entry = states.get(state);
  states.delete(state);
  for (const [key, value] of states) {
    if (value.expires < Date.now()) states.delete(key);
  }
  return Boolean(entry && entry.platform === platform && entry.expires >= Date.now());
}
