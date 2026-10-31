// Free helpers for reading shop pages from a static site (no server of our own).
// Shops block browsers from reading their pages directly (CORS), so we use the free
// Jina Reader service, which fetches the page and returns its text + image links.

import { getState } from "./db";

export interface PageInfo {
  title: string;
  description: string;
  text: string;
  images: string[];
  price?: number;
  url: string;
}

const JUNK_IMG = /(logo|icon|sprite|favicon|badge|payment|flag|avatar|placeholder|pixel|tracking|banner|\.svg|\.gif)(\?|$|[-_/.])/i;

export async function readPage(url: string): Promise<PageInfo> {
  const proxy = getState().settings.proxyUrl;
  if (proxy) {
    // Optional self-hosted helper (worker/ folder) — returns { title, image, price, brand, description }.
    const r = await fetch(`${proxy.replace(/\/$/, "")}/meta?url=${encodeURIComponent(url)}`);
    if (r.ok) {
      const m = await r.json();
      return { title: m.title || "", description: m.description || "", text: m.description || "", images: m.image ? [m.image] : [], price: Number(m.price) || undefined, url };
    }
  }
  const r = await fetch(`https://r.jina.ai/${url}`, {
    headers: { Accept: "application/json", "X-With-Images-Summary": "true", "X-Return-Format": "markdown" },
  });
  if (!r.ok) throw new Error(r.status === 429 ? "The free page reader is busy — try again in a minute." : "Couldn't read that page. Some shops block readers — try a direct image link instead.");
  const j = await r.json();
  const d = j.data || j;
  const text: string = d.content || d.text || "";
  const found: string[] = [];
  const add = (u?: string) => { if (u && /^https?:\/\//.test(u) && !JUNK_IMG.test(u) && !found.includes(u)) found.push(u); };
  // og:image style metadata first (usually the clean product shot), then images in reading order.
  add(d.metadata?.["og:image"]);
  add(d.metadata?.["twitter:image"]);
  if (d.images && typeof d.images === "object") Object.values(d.images as Record<string, string>).forEach((u) => add(u));
  for (const m of text.matchAll(/!\[[^\]]*\]\((https?:[^)\s]+)/g)) add(m[1]);
  return {
    title: d.title || d.metadata?.["og:title"] || "",
    description: d.description || d.metadata?.["og:description"] || "",
    text,
    images: found.slice(0, 30),
    price: findPrice(text),
    url,
  };
}

export function findPrice(text: string): number | undefined {
  const m = text.match(/(?:₹|£|\$|€|Rs\.?|INR|USD|GBP|EUR)\s?([0-9][0-9,]*(?:\.[0-9]{2})?)/);
  if (!m) return undefined;
  const n = Number(m[1].replace(/,/g, ""));
  return n > 0 && n < 1e7 ? n : undefined;
}

/** Search pages people can open to find a clean product photo by hand (always free). */
export function searchLinks(query: string) {
  const q = encodeURIComponent(query);
  return [
    { label: "Google Images", url: `https://www.google.com/search?tbm=isch&q=${q}` },
    { label: "Google Shopping", url: `https://www.google.com/search?tbm=shop&q=${q}` },
    { label: "Bing Images", url: `https://www.bing.com/images/search?q=${q}` },
    { label: "Pinterest", url: `https://www.pinterest.com/search/pins/?q=${q}` },
  ];
}
