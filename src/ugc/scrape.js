// Fetches a product page and pulls out what the video needs: name,
// description, price, brand and product images. Works off standard
// signals (JSON-LD Product, OpenGraph, meta tags) so it copes with most
// storefronts (Shopify, Woo, Amazon-style pages) without per-site code.

const FETCH_TIMEOUT_MS = 20000;
const MAX_HTML_BYTES = 3 * 1024 * 1024;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

function meta(html, ...names) {
  for (const name of names) {
    const re = new RegExp(
      `<meta[^>]+(?:property|name)=["']${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>`,
      "i"
    );
    const tag = html.match(re)?.[0];
    const content = tag?.match(/content=["']([^"']*)["']/i)?.[1];
    if (content) return decodeEntities(content).trim();
  }
  return null;
}

function jsonLdProducts(html) {
  const products = [];
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const parsed = JSON.parse(m[1].trim());
      const nodes = [];
      const collect = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(collect);
        nodes.push(node);
        if (node["@graph"]) collect(node["@graph"]);
      };
      collect(parsed);
      for (const node of nodes) {
        const type = [].concat(node["@type"] || []).map(String);
        if (type.some((t) => /product/i.test(t))) products.push(node);
      }
    } catch { /* malformed JSON-LD is everywhere; ignore */ }
  }
  return products;
}

function absolute(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return null;
  }
}

export async function scrapeProduct(productUrl) {
  const url = new URL(productUrl); // throws on garbage input
  if (!/^https?:$/.test(url.protocol)) throw new Error("Product URL must be http(s)");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(`Could not reach the product page: ${err.message || err}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new Error(`Product page answered ${res.status} ${res.statusText}`);

  const html = decodeEntities((await res.text()).slice(0, MAX_HTML_BYTES));
  const finalUrl = res.url || url.toString();

  const product = {
    url: finalUrl,
    site: new URL(finalUrl).hostname.replace(/^www\./, ""),
    name: null,
    description: null,
    price: null,
    currency: null,
    brand: null,
    images: [],
  };

  // Structured data first - it is the most reliable when present.
  const ld = jsonLdProducts(html)[0];
  if (ld) {
    product.name = String(ld.name || "").trim() || null;
    product.description = String(ld.description || "").trim() || null;
    product.brand = String(ld.brand?.name || ld.brand || "").trim() || null;
    const offer = [].concat(ld.offers || [])[0];
    if (offer) {
      product.price = offer.price ?? offer.lowPrice ?? null;
      product.currency = offer.priceCurrency || null;
    }
    for (const img of [].concat(ld.image || [])) {
      const src = typeof img === "string" ? img : img?.url;
      const abs = src && absolute(src, finalUrl);
      if (abs) product.images.push(abs);
    }
  }

  // OpenGraph / meta fallbacks.
  product.name ||=
    meta(html, "og:title", "twitter:title") ||
    decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim() ||
    null;
  product.description ||=
    meta(html, "og:description", "twitter:description", "description") || null;
  product.price ||= meta(html, "product:price:amount", "og:price:amount");
  product.currency ||= meta(html, "product:price:currency", "og:price:currency");
  product.brand ||= meta(html, "og:site_name");

  const ogImage = meta(html, "og:image", "og:image:secure_url", "twitter:image");
  if (ogImage) {
    const abs = absolute(ogImage, finalUrl);
    if (abs) product.images.unshift(abs);
  }

  // Round out the gallery with large-looking product <img> tags.
  if (product.images.length < 6) {
    const imgRe = /<img[^>]+(?:src|data-src)=["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = imgRe.exec(html)) && product.images.length < 10) {
      const src = m[1];
      if (/\.svg|sprite|logo|icon|favicon|pixel|badge|\.gif/i.test(src)) continue;
      const abs = absolute(src, finalUrl);
      if (abs && /^https?:/.test(abs)) product.images.push(abs);
    }
  }

  product.images = [...new Set(product.images)].slice(0, 8);
  product.name = product.name?.slice(0, 200) || null;
  product.description = product.description?.replace(/\s+/g, " ").trim().slice(0, 1200) || null;

  if (!product.name) {
    throw new Error("Could not find a product on that page (no title/JSON-LD/OpenGraph data)");
  }
  return product;
}

// Downloads up to `limit` product images for the local renderer. Returns
// the list of file paths that actually downloaded fine.
export async function downloadImages(images, destDir, limit = 5) {
  const fs = await import("node:fs");
  const path = await import("node:path");
  fs.mkdirSync(destDir, { recursive: true });

  const saved = [];
  for (const [i, src] of images.slice(0, limit).entries()) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(src, {
        headers: { "User-Agent": UA },
        signal: controller.signal,
      }).finally(() => clearTimeout(timer));
      if (!res.ok) continue;
      const type = res.headers.get("content-type") || "";
      if (!/image\/(jpe?g|png|webp)/i.test(type)) continue;
      const ext = /png/i.test(type) ? ".png" : /webp/i.test(type) ? ".webp" : ".jpg";
      const file = path.join(destDir, `img${i}${ext}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 5000) continue; // skip tracking pixels / tiny thumbs
      fs.writeFileSync(file, buf);
      saved.push(file);
    } catch { /* skip broken images */ }
  }
  return saved;
}
