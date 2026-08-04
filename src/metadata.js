import config from "./config.js";
import { fixBrandName, BRAND_NAME } from "./brand.js";

export function metadataEnabled() {
  return config.generateMetadata && Boolean(config.openaiApiKey);
}

// Asks a GPT model for per-clip publishing metadata based on the clip's
// transcript: a unique hook title, a short description, and discovery
// hashtags. Returns {title, description, hashtags[]} or throws.
export async function generateClipMetadata({ transcript, videoTitle, part, totalParts }) {
  const clean = fixBrandName(transcript);
  const excerpt = clean.length > 4000 ? `${clean.slice(0, 4000)}...` : clean;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.openaiApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: config.openaiChatModel,
      temperature: 0.8,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write publishing metadata for short-form vertical videos (YouTube Shorts, Instagram Reels, TikTok). " +
            "Reply with JSON only: {\"title\": string, \"description\": string, \"hashtags\": string[]}. " +
            "title: a unique, punchy hook drawn from the most interesting moment in the transcript, max 60 characters, " +
            "no surrounding quotes, no misleading claims. " +
            "description: 1-2 natural sentences summarizing the clip. " +
            "hashtags: 8-12 lowercase hashtags starting with #, mixing content-specific tags with broad " +
            "short-form discovery tags (like #shorts #reels #fyp). " +
            `The speaker's product is named "${BRAND_NAME}" - if it comes up, always spell it exactly ` +
            `"${BRAND_NAME}" (never Klint, Clinton, or other variants the transcript may contain).`,
        },
        {
          role: "user",
          content:
            `Series title: ${videoTitle}\nThis clip: part ${part} of ${totalParts}\n\n` +
            `Transcript of this clip:\n${excerpt}`,
        },
      ],
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Metadata generation failed (${res.status}): ${JSON.stringify(data)}`);
  }

  const parsed = JSON.parse(data.choices?.[0]?.message?.content || "{}");
  const title = fixBrandName(String(parsed.title || "").trim().slice(0, 80));
  if (!title) throw new Error("Metadata generation returned no title");

  const hashtags = (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
    .map((h) => fixBrandName(String(h).trim()).toLowerCase())
    .filter(Boolean)
    .map((h) => (h.startsWith("#") ? h : `#${h}`))
    .slice(0, 15);

  return {
    title,
    description: fixBrandName(String(parsed.description || "").trim().slice(0, 500)),
    hashtags,
  };
}
