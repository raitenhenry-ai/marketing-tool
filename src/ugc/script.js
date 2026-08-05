import config from "../config.js";

// Turns scraped product data into a UGC-style talking script plus the
// caption/hashtags used when posting. Uses the OpenAI chat model when a key
// is configured; otherwise falls back to a decent template so the pipeline
// still works end to end.

const TONES = {
  casual: "casual and friendly, like recommending it to a close friend",
  excited: "high-energy and enthusiastic, genuinely hyped about the find",
  professional: "polished and confident, like a knowledgeable reviewer",
  storytelling: "personal storytelling - a before/after experience with the product",
};

export function toneOptions() {
  return Object.keys(TONES);
}

// Video style angles - the "trending styles" the studio UI offers.
const STYLES = {
  product_pov: "Show the product being used in real everyday situations (product POV angle).",
  grwm: "Frame it as a get-ready-with-me routine where the product is the star step.",
  unboxing: "Frame it as a satisfying unboxing with a reveal moment.",
  before_after: "Lean on the before/after transformation the product delivers.",
  demo: "A quick, punchy demo of exactly how the product works.",
};

export function styleOptions() {
  return Object.keys(STYLES);
}

export async function generateScript(product, settings = {}) {
  const tone = TONES[settings.tone] ? settings.tone : "casual";
  if (!config.openaiApiKey) return templateScript(product, tone);

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiChatModel,
      temperature: 0.9,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write scripts for short UGC-style product videos (TikTok/Reels/Shorts), " +
            "spoken by a single creator holding or showing the product. " +
            'Reply with JSON only: {"hook": string, "scenes": [{"text": string}], ' +
            '"cta": string, "caption": string, "hashtags": string[]}. ' +
            "hook: a scroll-stopping first line, max 12 words, no hashtags. " +
            "scenes: 3-4 short spoken lines (max 20 words each) covering what the product is, " +
            "the standout benefit, and a personal touch - natural spoken language, no emoji. " +
            "cta: one closing spoken line telling viewers where to get it. " +
            "caption: 1-2 sentences for the post text, may include 1-2 emoji. " +
            "hashtags: 6-10 lowercase hashtags starting with #, mixing product-specific and " +
            "discovery tags (#tiktokmademebuyit #fyp style). " +
            `Overall voice: ${TONES[tone]}. ` +
            (STYLES[settings.style] ? `Video angle: ${STYLES[settings.style]} ` : "") +
            "Never invent specs, medical claims or fake discounts.",
        },
        {
          role: "user",
          content:
            `Product: ${product.name}\n` +
            (product.brand ? `Brand: ${product.brand}\n` : "") +
            (product.price ? `Price: ${product.price} ${product.currency || ""}\n` : "") +
            `Store: ${product.site}\n\n` +
            `Product description:\n${product.description || "(none found)"}`,
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Script generation failed (${res.status}): ${JSON.stringify(data).slice(0, 300)}`);
  }

  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .map((s) => String(s?.text || s || "").trim())
    .filter(Boolean)
    .slice(0, 5);
  if (!parsed.hook || !scenes.length) throw new Error("Script generation returned an empty script");

  return {
    tone,
    hook: String(parsed.hook).trim().slice(0, 120),
    scenes,
    cta: String(parsed.cta || `Get yours at ${product.site}`).trim().slice(0, 160),
    caption: String(parsed.caption || product.name).trim().slice(0, 500),
    hashtags: (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
      .map((h) => String(h).trim().toLowerCase())
      .filter(Boolean)
      .map((h) => (h.startsWith("#") ? h : `#${h}`))
      .slice(0, 12),
    generatedBy: "openai",
  };
}

function templateScript(product, tone) {
  const name = product.name;
  const blurb = (product.description || "").split(/(?<=[.!?])\s+/)[0]?.slice(0, 140);
  return {
    tone,
    hook: `Okay, I have to show you this - ${name}`.slice(0, 120),
    scenes: [
      `So this is the ${name}${product.brand ? ` from ${product.brand}` : ""}.`,
      blurb || `I've been using it every single day and it honestly delivers.`,
      product.price
        ? `And it's only ${product.price} ${product.currency || ""} right now.`.trim()
        : `The quality for the price genuinely surprised me.`,
    ],
    cta: `Grab it at ${product.site} - link in bio.`,
    caption: `${name} - you need this in your life 🔥`,
    hashtags: [
      "#tiktokmademebuyit", "#musthaves", "#viralproducts", "#fyp",
      "#unboxing", "#productreview", "#shopping",
    ],
    generatedBy: "template",
  };
}

// Full spoken text, used for the voiceover / avatar input.
export function spokenText(script) {
  return [script.hook, ...script.scenes, script.cta].filter(Boolean).join(" ");
}

// Post caption assembled the same way the shortform tool builds captions.
export function captionText(script, product) {
  return [script.caption, script.hashtags?.join(" "), product?.url]
    .filter(Boolean)
    .join("\n\n");
}
