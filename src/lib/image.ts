import { loadImage } from "./colors";

/** Downscale + re-encode a photo so the wardrobe stays small on disk. Keeps transparency. */
export async function prepareImage(src: Blob, max = 1200, force = false): Promise<Blob> {
  const img = await loadImage(src);
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(img, 0, 0, w, h);
  const out = await canvasBlob(c, "image/webp", 0.86);
  // Some browsers (older Safari) can't encode WebP and silently return PNG — that's fine.
  return force || out.size < src.size || src.size > 2_000_000 ? out : src;
}

/** Crops away fully transparent margins (after background removal) and adds a little padding. */
export async function trimTransparent(src: Blob): Promise<Blob> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = img.width; c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = 0, y1 = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > 12) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 <= x0 || y1 <= y0) return src;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return canvasBlob(o, "image/webp", 0.9).then((b) => (b.type === "image/webp" ? b : canvasBlob(o, "image/png")));
}

function canvasBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));
}

// ---------- Background removal ----------
// Runs fully on-device (WebAssembly model, ~40MB downloaded once and cached by the browser).
// Loaded from a CDN only when first used so the app itself stays tiny.
const BG_LIB = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
let bgMod: Promise<any> | null = null;

export async function removeBackground(src: Blob, onProgress?: (msg: string) => void): Promise<Blob> {
  if (!bgMod) bgMod = import(/* @vite-ignore */ BG_LIB);
  const mod = await bgMod.catch((e) => { bgMod = null; throw e; });
  const out: Blob = await mod.removeBackground(src, {
    model: "isnet_fp16",
    output: { format: "image/png", quality: 0.9 },
    progress: (key: string, cur: number, total: number) => {
      if (onProgress && key.startsWith("fetch")) onProgress(`Downloading cut-out model ${Math.round((cur / Math.max(total, 1)) * 100)}%`);
      else if (onProgress && key.startsWith("compute")) onProgress("Cutting out…");
    },
  });
  return trimTransparent(out);
}

// ---------- Remote images ----------
/** Tries to download a remote image into a Blob. Most shops block this (CORS), so we fall back to relays. */
export async function fetchImageBlob(url: string, proxyUrl?: string): Promise<Blob | null> {
  const attempts = [url];
  if (proxyUrl) attempts.push(`${proxyUrl.replace(/\/$/, "")}/image?url=${encodeURIComponent(url)}`);
  // Free public image relay (images.weserv.nl) that allows cross-site downloads.
  attempts.push(`https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ""))}&w=1400&we&output=webp`);
  for (const u of attempts) {
    try {
      const r = await fetch(u, { mode: "cors" });
      if (!r.ok) continue;
      const b = await r.blob();
      if (b.type.startsWith("image/")) return b;
    } catch { /* try next */ }
  }
  return null;
}

export const isImageUrl = (u: string) => /\.(png|jpe?g|webp|avif|gif)(\?|#|$)/i.test(u);

export async function blobToBase64(b: Blob): Promise<{ data: string; mediaType: string }> {
  // Claude accepts jpeg/png/gif/webp. Re-encode to jpeg/webp at a modest size to keep requests cheap.
  const small = await prepareImage(b, 900, true);
  const buf = await small.arrayBuffer();
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const mediaType = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(small.type) ? small.type : "image/png";
  return { data: btoa(bin), mediaType };
}
