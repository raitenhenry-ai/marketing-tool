// Whisper mis-hears the product name ("Klint", "Clinton", "Klindt"...) and
// the error then propagates into captions and AI-generated titles. Normalize
// every variant to the canonical spelling before anything downstream sees it.
export const BRAND_NAME = "Clint";

const VARIANTS = /\b(klint|clint|clinton|klindt|clindt|klinton)(['’]s)?\b/gi;

export function fixBrandName(text) {
  return String(text || "").replace(VARIANTS, (m, _word, poss) =>
    BRAND_NAME + (poss ? "'s" : ""));
}
