// Optional AI features. Calls go straight from the browser to the chosen provider with the
// user's own key (stored only on this device). Nothing here is required for the app to work.
//
// Providers:
//  - gemini      Google Gemini free tier (OpenAI-compatible endpoint) — free, good with photos
//  - openrouter  Free open models (Kimi, Gemma, Qwen, Llama…) — free with daily limits
//  - custom      Any OpenAI-compatible server (Ollama on your computer, Groq, Moonshot/Kimi…)
//  - claude      Anthropic Claude — paid, best quality, can search shops on its own

import type Anthropic from "@anthropic-ai/sdk";
import type { BetaContentBlock, BetaMessageParam, BetaToolUnion } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getState } from "./db";
import { blobToBase64 } from "./image";
import { CATEGORIES, OCCASIONS, PATTERNS, SEASONS, type Item, type Provider } from "./types";
import { readPage } from "./web";

export class AIError extends Error {}

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", note: "Best results" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", note: "Faster, about half the cost" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", note: "Cheapest Claude" },
];

export const PROVIDERS: Record<Provider, { label: string; cost: string; keyUrl?: string; base?: string; vision?: string; text?: string; note: string }> = {
  gemini: {
    label: "Google Gemini",
    cost: "Free",
    keyUrl: "https://aistudio.google.com/apikey",
    base: "https://generativelanguage.googleapis.com/v1beta/openai",
    vision: "gemini-flash-lite-latest",
    text: "gemini-flash-latest",
    note: "Recommended free option. Strong at reading clothing photos. The free tier has daily limits, and Google may use free-tier prompts to improve its products.",
  },
  openrouter: {
    label: "OpenRouter free models",
    cost: "Free",
    keyUrl: "https://openrouter.ai/settings/keys",
    base: "https://openrouter.ai/api/v1",
    note: "Open models like Kimi, Gemma, Qwen and Llama at $0 (models ending in “:free”). Free use is capped at roughly 50 requests a day. Which models are free changes often — tap “find free models” to refresh.",
  },
  custom: {
    label: "Other (OpenAI-compatible)",
    cost: "Varies",
    note: "Any OpenAI-compatible server: Ollama or LM Studio on your own computer (free, private), Groq, Moonshot (Kimi), Together…",
  },
  claude: {
    label: "Claude (Anthropic)",
    cost: "Paid",
    keyUrl: "https://console.anthropic.com/settings/keys",
    note: "Best quality, and the only option that searches shops by itself to find a clean product photo. You pay Anthropic per use.",
  },
};

export function provider(): Provider {
  const s = getState().settings;
  return s.provider || (s.apiKey ? "claude" : "gemini");
}
function keyFor(p: Provider) {
  const s = getState().settings;
  return p === "claude" ? s.apiKey : s.keys?.[p];
}
export function hasAI() {
  const p = provider();
  if (p === "custom") return !!getState().settings.customBase;
  return !!keyFor(p);
}
/** Can the current provider search the web on its own? */
export const canSearchWeb = () => hasAI() && provider() === "claude";

function modelsFor(p: Provider) {
  const s = getState().settings;
  const m = s.models?.[p] || {};
  return { vision: m.vision || PROVIDERS[p].vision || "", text: m.text || m.vision || PROVIDERS[p].text || PROVIDERS[p].vision || "" };
}

// =====================================================================
// OpenAI-compatible providers (Gemini, OpenRouter, custom)
// =====================================================================
type OAIContent = string | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];
interface OAIMessage { role: "system" | "user" | "assistant"; content: OAIContent }

async function oaiChat(messages: OAIMessage[], kind: "vision" | "text", json = true): Promise<string> {
  const p = provider();
  const s = getState().settings;
  const base = (p === "custom" ? s.customBase : PROVIDERS[p].base)?.replace(/\/$/, "");
  if (!base) throw new AIError("Set the server address for your AI provider in Settings.");
  const model = modelsFor(p)[kind];
  if (!model) throw new AIError(`Choose a ${kind === "vision" ? "photo" : "chat"} model in Settings.`);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const key = keyFor(p);
  if (key) headers.Authorization = `Bearer ${key}`;
  if (p === "openrouter") { headers["HTTP-Referer"] = location.origin; headers["X-Title"] = "Drape"; }

  const send = async (withFormat: boolean) => {
    let r: Response;
    try {
      r = await fetch(`${base}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 4000, ...(json && withFormat ? { response_format: { type: "json_object" } } : {}) }),
      });
    } catch {
      throw new AIError(p === "custom" ? "Couldn't reach your AI server. If it's Ollama, start it with OLLAMA_ORIGINS=* so websites can connect." : "Couldn't reach the AI service. Check your connection.");
    }
    const data = await r.json().catch(() => null);
    return { r, data };
  };

  let { r, data } = await send(true);
  // Some free models don't support JSON mode — retry once without it.
  if (!r.ok && json && (r.status === 400 || r.status === 422)) ({ r, data } = await send(false));
  if (!r.ok) throw new AIError(oaiError(r.status, data, model));
  const msg = data?.choices?.[0]?.message;
  let text: string = typeof msg?.content === "string" ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c: { text?: string }) => c.text || "").join("") : "";
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  if (!text) throw new AIError("The model returned an empty answer. Try again, or pick another model in Settings.");
  return text;
}

function oaiError(status: number, data: any, model: string) {
  const err = Array.isArray(data) ? data[0]?.error : data?.error;
  const msg: string = err?.message || err?.metadata?.raw || "";
  if (status === 401 || status === 403 || /api key/i.test(msg)) return "Your API key was rejected. Check it in Settings.";
  if (status === 429) return "Free daily or per-minute limit reached. Wait a bit, or try again tomorrow.";
  if (status === 404 || /not a valid model|no endpoints|not found/i.test(msg)) return `The model “${model}” isn't available any more. Pick another in Settings (for OpenRouter, tap “find free models”).`;
  if (/image|vision|multimodal/i.test(msg)) return `“${model}” can't read photos. Choose a model that supports images in Settings.`;
  return `AI error (${status}): ${msg || "unknown"}`;
}

async function imageDataUrl(img: Blob) {
  const { data, mediaType } = await blobToBase64(img);
  return `data:${mediaType};base64,${data}`;
}

// =====================================================================
// Claude
// =====================================================================
let SDK: typeof Anthropic | null = null;
async function claudeClient() {
  const key = getState().settings.apiKey;
  if (!key) throw new AIError("Add your Claude API key in Settings.");
  if (!SDK) SDK = (await import("@anthropic-ai/sdk")).default;
  return new SDK({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 2 });
}

interface RunOpts {
  system: string;
  messages: BetaMessageParam[];
  web?: boolean;
  schema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}

/** One Claude request with streaming, refusal fallbacks and server-tool continuation handled. */
async function claudeRun(o: RunOpts): Promise<string> {
  const c = await claudeClient();
  const m = getState().settings.model || "claude-opus-5-5";
  const isHaiku = m.startsWith("claude-haiku");
  const tools: BetaToolUnion[] | undefined = o.web
    ? isHaiku
      ? [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }, { type: "web_fetch_20250910", name: "web_fetch", max_uses: 4 }]
      : [{ type: "web_search_20260209", name: "web_search", max_uses: 4 }, { type: "web_fetch_20260209", name: "web_fetch", max_uses: 5 }]
    : undefined;

  const messages = [...o.messages];
  for (let turn = 0; turn < 4; turn++) {
    let msg;
    try {
      const stream = c.beta.messages.stream({
        model: m,
        max_tokens: o.maxTokens ?? 16000,
        system: o.system,
        messages,
        ...(tools ? { tools } : {}),
        output_config: { effort: o.effort ?? "low", ...(o.schema ? { format: { type: "json_schema", schema: o.schema } } : {}) },
        // Haiku has no server-side fallback; the others retry a declined request on a suitable model.
        ...(isHaiku ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
      });
      msg = await stream.finalMessage();
    } catch (e) {
      throw new AIError(claudeError(e));
    }
    if (msg.stop_reason === "refusal") throw new AIError("Claude declined this request. Try a different photo or wording.");
    if (msg.stop_reason === "pause_turn") {
      // Long web research paused mid-way — hand the partial turn back so it can continue.
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }
    return msg.content.filter((b: BetaContentBlock) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
  }
  throw new AIError("The search took too long. Please try again.");
}

function claudeError(e: unknown): string {
  const A = SDK;
  if (!A) return e instanceof Error ? e.message : String(e);
  if (e instanceof A.AuthenticationError) return "Your API key was rejected. Check it in Settings.";
  if (e instanceof A.PermissionDeniedError) return "This API key isn't allowed to do that (web search may need enabling in the Claude Console).";
  if (e instanceof A.RateLimitError) return "Rate limit hit — wait a moment and try again.";
  if (e instanceof A.BadRequestError) return `Request rejected: ${e.message}`;
  if (e instanceof A.APIConnectionError) return "Couldn't reach Claude. Check your connection.";
  if (e instanceof A.APIError) return `Claude error (${e.status ?? "?"}): ${e.message}`;
  return e instanceof Error ? e.message : String(e);
}

// =====================================================================
// Shared helpers
// =====================================================================
/** Pulls the JSON object out of a model's answer, tolerating code fences and chatter. */
function parseJson<T>(text: string): T {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/g);
  if (fenced) for (const f of fenced.reverse()) { try { return JSON.parse(f.replace(/```(?:json)?/g, "")); } catch { /* next */ } }
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start >= 0 && end > start) { try { return JSON.parse(text.slice(start, end + 1)); } catch { /* fall through */ } }
  throw new AIError("The AI's answer couldn't be read. Try again (smaller free models sometimes slip up).");
}
const clamp = (n: number) => Math.max(1, Math.min(5, Math.round(Number(n) || 3)));
const oneOf = <T extends string>(v: unknown, list: readonly T[], d: T): T => (list.includes(v as T) ? (v as T) : d);
const listOf = <T extends string>(v: unknown, list: readonly T[]): T[] => (Array.isArray(v) ? (v.filter((x) => list.includes(x)) as T[]) : []);

// =====================================================================
// Tagging
// =====================================================================
export interface Tags {
  name: string;
  category: Item["category"];
  subcategory: string;
  colors: string[];
  pattern: Item["pattern"];
  material: string;
  seasons: Item["seasons"];
  occasions: Item["occasions"];
  formality: number;
  warmth: number;
  brand: string;
  searchQuery: string;
  isClothing: boolean;
  uprightRotation: number; // clockwise degrees (0/90/180/270) to make the garment upright
}

function cleanTags<T extends Partial<Tags>>(t: T): T & Tags {
  return {
    ...t,
    isClothing: t.isClothing !== false,
    name: String(t.name || ""),
    category: oneOf(t.category, CATEGORIES, "top"),
    subcategory: String(t.subcategory || ""),
    colors: (Array.isArray(t.colors) ? t.colors : []).filter((c) => /^#[0-9a-f]{6}$/i.test(String(c))),
    pattern: oneOf(t.pattern, PATTERNS, "solid"),
    material: String(t.material || ""),
    seasons: listOf(t.seasons, SEASONS),
    occasions: listOf(t.occasions, OCCASIONS),
    formality: clamp(t.formality as number),
    warmth: clamp(t.warmth as number),
    brand: String(t.brand || ""),
    searchQuery: String(t.searchQuery || ""),
    uprightRotation: [0, 90, 180, 270].includes(Number(t.uprightRotation)) ? Number(t.uprightRotation) : 0,
  };
}

const TAG_KEYS = `{"isClothing":true,"name":"short shop-style name e.g. Oversized white oxford shirt","category":"${CATEGORIES.join("|")}","subcategory":"e.g. T-shirt, Jeans, Blazer, Sneakers","colors":["1-3 main garment colours as hex, most dominant first"],"pattern":"${PATTERNS.join("|")}","material":"","seasons":["${SEASONS.join("|")}"],"occasions":["${OCCASIONS.join("|")}"],"formality":"1 very casual … 5 formal","warmth":"1 very light … 5 very warm","brand":"only if a logo/label is clearly visible, else empty","searchQuery":"best web search query to find this exact product","uprightRotation":"0|90|180|270 — degrees to rotate the photo CLOCKWISE so the garment is upright (collar, neckline or waistband at the top). 0 if already upright"}`;
const TAG_SYSTEM = "You catalogue clothing for a personal digital wardrobe app. Describe only the main garment in the photo. If several garments are visible, pick the most prominent one.";

const TAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["isClothing", "name", "category", "subcategory", "colors", "pattern", "material", "seasons", "occasions", "formality", "warmth", "brand", "searchQuery", "uprightRotation"],
  properties: {
    isClothing: { type: "boolean" },
    name: { type: "string", description: "Short shop-style name, e.g. 'Oversized white oxford shirt'" },
    category: { type: "string", enum: [...CATEGORIES] },
    subcategory: { type: "string", description: "e.g. T-shirt, Jeans, Blazer, Sneakers" },
    colors: { type: "array", items: { type: "string", description: "hex like #1f2a44" }, description: "1-3 main garment colours, most dominant first" },
    pattern: { type: "string", enum: [...PATTERNS] },
    material: { type: "string" },
    seasons: { type: "array", items: { type: "string", enum: [...SEASONS] } },
    occasions: { type: "array", items: { type: "string", enum: [...OCCASIONS] } },
    formality: { type: "integer", description: "1 very casual … 5 formal" },
    warmth: { type: "integer", description: "1 very light (tank, linen) … 5 very warm (wool coat, puffer)" },
    brand: { type: "string", description: "Only if a logo/label is clearly visible, else empty" },
    searchQuery: { type: "string", description: "Best web search query to find this exact product online" },
    uprightRotation: { type: "integer", enum: [0, 90, 180, 270], description: "Degrees to rotate the photo clockwise so the garment is upright (collar/neckline/waistband at the top); 0 if already upright" },
  },
};

export async function tagPhoto(img: Blob): Promise<Tags> {
  if (provider() === "claude") {
    const { data, mediaType } = await blobToBase64(img);
    const text = await claudeRun({
      system: TAG_SYSTEM,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } },
        { type: "text", text: "Tag this item for my wardrobe." },
      ] }],
      schema: TAG_SCHEMA, effort: "low", maxTokens: 4000,
    });
    return cleanTags(parseJson<Tags>(text));
  }
  const text = await oaiChat([
    { role: "system", content: TAG_SYSTEM },
    { role: "user", content: [
      { type: "image_url", image_url: { url: await imageDataUrl(img) } },
      { type: "text", text: `Tag this item for my wardrobe. Reply with ONLY a JSON object with exactly these keys:\n${TAG_KEYS}` },
    ] },
  ], "vision");
  return cleanTags(parseJson<Tags>(text));
}

// =====================================================================
// Product lookup (Claude only: needs live web search)
// =====================================================================
export interface ProductMatch {
  title: string;
  brand: string;
  pageUrl: string;
  imageUrl: string;
  price: string;
  confidence: "exact" | "similar";
}

export async function findProduct(img: Blob, hint: string): Promise<ProductMatch[]> {
  if (provider() !== "claude") throw new AIError("Automatic shop search needs Claude. Use the search links instead — it's free.");
  const { data, mediaType } = await blobToBase64(img);
  const text = await claudeRun({
    system: "You help people digitise their wardrobe by finding the official online product listing for clothes they photograph, so the app can use a clean product photo.",
    messages: [{ role: "user", content: [
      { type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } },
      { type: "text", text: `Find this item (or the closest match) on retailer websites.${hint ? ` Hints: ${hint}.` : ""} Look for visible logos, labels, stitching and cut. Then fetch the best product pages to get their main image URLs.

Return ONLY a JSON object, no other text: {"matches":[{"title":"","brand":"","pageUrl":"","imageUrl":"","price":"","confidence":"exact|similar"}]}
- imageUrl must be a direct link to the product's main packshot image (a .jpg/.png/.webp URL, usually the page's og:image or main gallery image), ideally on a plain white or light background.
- Only include URLs you actually saw in search results or fetched pages. Never invent URLs.
- Up to 4 matches, best first. Use "exact" only when you're confident it's the same product.` },
    ] }],
    web: true, effort: "medium",
  });
  return (parseJson<{ matches: ProductMatch[] }>(text).matches || []).filter((m) => m.imageUrl?.startsWith("http"));
}

/** A search query for the item, for the free "search it yourself" flow. */
export async function searchQueryFor(img: Blob | null, fallback: string): Promise<string> {
  if (!img || !hasAI()) return fallback;
  try { const t = await tagPhoto(img); return t.searchQuery || fallback; } catch { return fallback; }
}

// =====================================================================
// Links
// =====================================================================
export interface LinkProduct extends Tags {
  imageUrl: string;
  price: number | null;
  currency: string;
  pageUrl: string;
}

const LINK_KEYS = (url: string) => `{"isClothing":true,"name":"","category":"${CATEGORIES.join("|")}","subcategory":"","colors":["#hex"],"pattern":"${PATTERNS.join("|")}","material":"","seasons":["${SEASONS.join("|")}"],"occasions":["${OCCASIONS.join("|")}"],"formality":1-5,"warmth":1-5,"brand":"","searchQuery":"","imageUrl":"direct URL of the main product image","price":number or null,"currency":"","pageUrl":"${url}"}`;

export async function importFromLink(url: string): Promise<LinkProduct> {
  if (provider() === "claude") {
    const text = await claudeRun({
      system: "You turn product page links into wardrobe entries. Fetch the page and read the product details.",
      messages: [{ role: "user", content: `Fetch this product page and describe the item: ${url}\n\nReturn ONLY a JSON object, no other text, with these keys:\n${LINK_KEYS(url)}\nOnly use an imageUrl that appears in the fetched page (og:image or first gallery image). Never invent one.` }],
      web: true, effort: "low",
    });
    const p = parseJson<LinkProduct>(text);
    return { ...cleanTags(p), imageUrl: p.imageUrl, price: p.price, currency: p.currency, pageUrl: url };
  }
  // Free path: read the page with the free reader, then let the model pick out the details.
  const page = await readPage(url);
  const text = await oaiChat([
    { role: "system", content: "You turn product pages into wardrobe entries." },
    { role: "user", content: `Product page: ${url}
Title: ${page.title}
Description: ${page.description}
Image URLs found on the page (in order):
${page.images.map((u, i) => `${i + 1}. ${u}`).join("\n") || "(none)"}

Page text (trimmed):
${page.text.slice(0, 7000)}

Reply with ONLY a JSON object with these keys:
${LINK_KEYS(url)}
imageUrl must be copied exactly from the list above — pick the main product photo (not a logo, model close-up of something else, or icon).` },
  ], "text");
  const p = parseJson<LinkProduct>(text);
  const imageUrl = page.images.includes(p.imageUrl) ? p.imageUrl : page.images[0] || "";
  return { ...cleanTags(p), name: p.name || page.title, imageUrl, price: p.price ?? page.price ?? null, currency: p.currency || "", pageUrl: url };
}

// =====================================================================
// Stylist chat
// =====================================================================
export interface StylistReply {
  message: string;
  outfits: { name: string; itemIds: string[]; why: string }[];
}

const STYLIST_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["message", "outfits"],
  properties: {
    message: { type: "string", description: "Friendly, concise reply (2-5 sentences). No markdown headings." },
    outfits: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "itemIds", "why"],
        properties: { name: { type: "string" }, itemIds: { type: "array", items: { type: "string" } }, why: { type: "string" } },
      },
    },
  },
};

export function wardrobeDigest(items: Item[], wearCounts: Record<string, number>) {
  return items
    .filter((i) => i.status === "owned")
    .map((i) => [i.id, i.name, i.category, i.subcategory || "", i.colors.join(" "), i.pattern, `f${i.formality}`, `w${i.warmth}`, i.occasions.join("/"), `worn${wearCounts[i.id] || 0}`].join(" | "))
    .join("\n");
}

export async function askStylist(history: { role: "user" | "assistant"; content: string }[], context: string): Promise<StylistReply> {
  const system = `You are a warm, honest personal stylist inside a wardrobe app. You only build outfits from the user's own wardrobe listed below (use the exact item ids). A complete outfit is usually top + bottom + shoes (or dress + shoes), plus outerwear when it's cold or wet, optionally a bag/accessory. Mention shopping gaps only when asked or clearly useful. Return 0-3 outfits.

Wardrobe (id | name | category | type | colours | pattern | formality 1-5 | warmth 1-5 | occasions | times worn):
${context}`;
  let text: string;
  if (provider() === "claude") {
    text = await claudeRun({ system, messages: history, schema: STYLIST_SCHEMA, effort: "medium", maxTokens: 8000 });
  } else {
    text = await oaiChat([
      { role: "system", content: `${system}\n\nAlways reply with ONLY a JSON object: {"message":"your reply, 2-5 sentences","outfits":[{"name":"","itemIds":["exact ids from the list"],"why":"one sentence"}]}` },
      ...history,
    ], "text");
  }
  const r = parseJson<StylistReply>(text);
  return { message: String(r.message || ""), outfits: Array.isArray(r.outfits) ? r.outfits : [] };
}

// =====================================================================
// Model discovery for Settings
// =====================================================================
export interface ModelInfo { id: string; name: string; vision: boolean; free: boolean }

export async function listModels(p: Provider, key?: string, base?: string): Promise<ModelInfo[]> {
  if (p === "openrouter") {
    const r = await fetch("https://openrouter.ai/api/v1/models");
    const j = await r.json();
    return (j.data as any[]).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      vision: (m.architecture?.input_modalities || []).includes("image"),
      free: m.pricing?.prompt === "0" && m.pricing?.completion === "0",
    }));
  }
  const b = (p === "custom" ? base : PROVIDERS[p].base)?.replace(/\/$/, "");
  if (!b) return [];
  const r = await fetch(`${b}/models`, { headers: key ? { Authorization: `Bearer ${key}` } : {} });
  if (!r.ok) throw new AIError(oaiError(r.status, await r.json().catch(() => null), ""));
  const j = await r.json();
  return ((j.data || []) as any[]).map((m) => {
    const id = String(m.id).replace(/^models\//, "");
    return { id, name: id, vision: /gemini|vl|vision|llava|gemma-3|gemma-4|pixtral|llama-4|qwen.*vl|kimi-k2\.5|minicpm/i.test(id), free: p === "gemini" };
  });
}

/** Sensible picks from OpenRouter's current free list: a vision model for photos, Kimi (if free) for chat. */
export function pickFree(models: ModelInfo[]) {
  const free = models.filter((m) => m.free && m.id.endsWith(":free"));
  const rank = (m: ModelInfo, prefs: RegExp[]) => { const i = prefs.findIndex((r) => r.test(m.id)); return i < 0 ? 99 : i; };
  const vis = free.filter((m) => m.vision).sort((a, b) => rank(a, [/gemini/, /qwen.*vl|qwen3/, /gemma-4|gemma-3/, /llama-4/, /mistral-small/, /nemotron.*vl/]) - rank(b, [/gemini/, /qwen.*vl|qwen3/, /gemma-4|gemma-3/, /llama-4/, /mistral-small/, /nemotron.*vl/]));
  const txt = [...free].sort((a, b) => rank(a, [/kimi/, /deepseek/, /qwen/, /llama/, /gemma/]) - rank(b, [/kimi/, /deepseek/, /qwen/, /llama/, /gemma/]));
  return { vision: vis[0]?.id, text: txt[0]?.id, free };
}

// =====================================================================
// Orientation only (cheap): used when tidying existing photos
// =====================================================================
export async function uprightRotation(img: Blob): Promise<number> {
  const ask = 'Look at the garment. How many degrees must this photo be rotated CLOCKWISE so the garment is upright (collar, neckline or waistband at the top)? Reply with ONLY a JSON object: {"uprightRotation": 0 | 90 | 180 | 270}';
  let text: string;
  if (provider() === "claude") {
    const { data, mediaType } = await blobToBase64(img);
    text = await claudeRun({ system: "You check photo orientation.", messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType as "image/png", data } }, { type: "text", text: ask }] }], effort: "low", maxTokens: 2000 });
  } else {
    text = await oaiChat([{ role: "user", content: [{ type: "image_url", image_url: { url: await imageDataUrl(img) } }, { type: "text", text: ask }] }], "vision");
  }
  const r = Number(parseJson<{ uprightRotation: number }>(text).uprightRotation);
  return [90, 180, 270].includes(r) ? r : 0;
}

// =====================================================================
// AI re-shoot (paid on Google): regenerate the photo as a pressed, straight product flat-lay
// =====================================================================
const RESHOOT_PROMPT = "Turn this photo into a clean e-commerce flat-lay product photo of the SAME garment: neatly pressed with no wrinkles or creases, laid perfectly straight and upright (waistband or collar at the top), symmetrical and centred, on a plain pure white background, soft even studio light, true-to-life colour. Keep the exact garment: same colour, fabric, texture, cut, length, pockets, seams, buttons and any logos. Do not add or remove details. No hanger, no person, no props.";
const IMAGE_MODELS = ["gemini-2.5-flash-image", "gemini-3.1-flash-image"];

export async function reshoot(img: Blob): Promise<Blob> {
  const s = getState().settings;
  const key = s.keys?.gemini;
  if (!key) throw new AIError("AI re-shoot uses Google Gemini. Add a Gemini key in Settings › AI.");
  const { data, mediaType } = await blobToBase64(img);
  let lastErr = "";
  for (const model of IMAGE_MODELS) {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: mediaType, data } }, { text: RESHOOT_PROMPT }] }],
        generationConfig: { responseModalities: ["IMAGE"] },
      }),
    }).catch(() => null);
    if (!r) throw new AIError("Couldn't reach Google. Check your connection.");
    const j = await r.json().catch(() => null);
    if (r.ok) {
      const parts = j?.candidates?.[0]?.content?.parts || [];
      const p = parts.find((x: any) => x.inlineData || x.inline_data);
      const d = p?.inlineData || p?.inline_data;
      if (d?.data) {
        const bin = atob(d.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: d.mimeType || d.mime_type || "image/png" });
      }
      lastErr = "Google didn't return an image. Try again.";
      continue;
    }
    const msg: string = (Array.isArray(j) ? j[0]?.error?.message : j?.error?.message) || "";
    if (r.status === 429 && /limit: 0/.test(msg)) throw new AIError("Google's free tier doesn't include photo editing. To use AI re-shoot, turn on billing for your Google AI Studio project (about 3p per photo). The free tidy-up still works.");
    if (r.status === 429) throw new AIError("Google's image limit was reached — try again in a minute.");
    lastErr = msg || `Google error ${r.status}`;
    if (r.status !== 404) break;
  }
  throw new AIError(lastErr || "AI re-shoot failed.");
}
