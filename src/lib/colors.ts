// Colour helpers: naming, harmony rules and dominant-colour extraction from photos.

export interface HSL { h: number; s: number; l: number }

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function rgbToHex(r: number, g: number, b: number) {
  return "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
}
export function hexToHsl(hex: string): HSL {
  const [r0, g0, b0] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r0, g0, b0), min = Math.min(r0, g0, b0);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r0) h = (g0 - b0) / d + (g0 < b0 ? 6 : 0);
    else if (max === g0) h = (b0 - r0) / d + 2;
    else h = (r0 - g0) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

// Named palette used for labels and filters.
export const NAMED: { name: string; hex: string }[] = [
  { name: "Black", hex: "#111111" },
  { name: "Charcoal", hex: "#3a3a3c" },
  { name: "Grey", hex: "#8e8e93" },
  { name: "Light grey", hex: "#c9c9cc" },
  { name: "White", hex: "#f7f7f5" },
  { name: "Cream", hex: "#efe6d2" },
  { name: "Beige", hex: "#d6c3a3" },
  { name: "Camel", hex: "#b88a55" },
  { name: "Brown", hex: "#6b4a32" },
  { name: "Khaki", hex: "#8f8a5c" },
  { name: "Olive", hex: "#5c6236" },
  { name: "Navy", hex: "#1f2a44" },
  { name: "Dark denim", hex: "#2c3a52" },
  { name: "Denim", hex: "#4a6385" },
  { name: "Light blue", hex: "#a9c4e2" },
  { name: "Blue", hex: "#2f5bd3" },
  { name: "Teal", hex: "#1f7a7a" },
  { name: "Green", hex: "#2f8a4c" },
  { name: "Sage", hex: "#a3b39a" },
  { name: "Mint", hex: "#bfe3cf" },
  { name: "Yellow", hex: "#f2cf3c" },
  { name: "Mustard", hex: "#c99a2e" },
  { name: "Orange", hex: "#e8742f" },
  { name: "Rust", hex: "#a64b2a" },
  { name: "Red", hex: "#c8262e" },
  { name: "Burgundy", hex: "#6d1f2c" },
  { name: "Pink", hex: "#f0a3b6" },
  { name: "Hot pink", hex: "#e0418b" },
  { name: "Lilac", hex: "#c6b2e0" },
  { name: "Purple", hex: "#6a3fa0" },
];

const NEUTRAL_NAMES = new Set(["Black", "Charcoal", "Grey", "Light grey", "White", "Cream", "Beige", "Camel", "Brown", "Khaki", "Navy", "Dark denim", "Denim", "Olive"]);

function dist(a: string, b: string) {
  const [r1, g1, b1] = hexToRgb(a), [r2, g2, b2] = hexToRgb(b);
  // weighted RGB distance — cheap and good enough for naming
  const rm = (r1 + r2) / 2;
  return Math.sqrt((2 + rm / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - rm) / 256) * (b1 - b2) ** 2);
}
export function colorName(hex: string) {
  let best = NAMED[0], bd = Infinity;
  for (const c of NAMED) {
    const d = dist(hex, c.hex);
    if (d < bd) { bd = d; best = c; }
  }
  return best.name;
}

export function isNeutral(hex: string) {
  if (NEUTRAL_NAMES.has(colorName(hex))) return true;
  const { s, l } = hexToHsl(hex);
  return s < 0.18 || l < 0.14 || l > 0.92;
}

const hueGap = (a: number, b: number) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

export type PairVerdict = { score: number; reason?: string };

/** How well two colours sit together. Positive = good, negative = clash. */
export function pairScore(a: string, b: string): PairVerdict {
  const na = isNeutral(a), nb = isNeutral(b);
  const A = hexToHsl(a), B = hexToHsl(b);
  if (na && nb) {
    const contrast = Math.abs(A.l - B.l);
    return { score: contrast > 0.25 ? 1.2 : 0.8, reason: "neutrals" };
  }
  if (na || nb) return { score: 1, reason: "neutral-anchor" };
  const gap = hueGap(A.h, B.h);
  if (gap < 22) return { score: 1.1, reason: "tonal" };
  if (gap < 50) return { score: 0.7, reason: "analogous" };
  if (gap > 150) return { score: Math.min(A.s, B.s) > 0.6 ? 0.2 : 0.6, reason: "complementary" };
  // the awkward middle of the wheel, worse when both are loud
  const loud = A.s > 0.55 && B.s > 0.55;
  return { score: loud ? -1.2 : -0.4, reason: "clash" };
}

// ---------- Extraction ----------
/** Finds up to 3 dominant colours, ignoring transparent pixels and the photo's background. */
export async function extractColors(src: string | Blob): Promise<string[]> {
  const img = await loadImage(src);
  const N = 72;
  const ratio = img.width / img.height;
  const w = ratio >= 1 ? N : Math.round(N * ratio), h = ratio >= 1 ? Math.round(N / ratio) : N;
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  let data: Uint8ClampedArray;
  try { data = ctx.getImageData(0, 0, w, h).data; } catch { return []; }

  // Estimate background from the border pixels.
  const border: number[][] = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) border.push(px(data, w, x, y));
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) border.push(px(data, w, x, y));
  const opaqueBorder = border.filter((p) => p[3] > 200);
  const bg = opaqueBorder.length > border.length * 0.6 ? median(opaqueBorder) : null;

  // Weight centre pixels more — garments are usually centred.
  const pts: number[][] = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = px(data, w, x, y);
    if (p[3] < 160) continue;
    if (bg && Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) < 42) continue;
    pts.push(p);
    const cx = Math.abs(x / w - 0.5), cy = Math.abs(y / h - 0.5);
    if (cx < 0.25 && cy < 0.25) pts.push(p);
  }
  if (pts.length < 20) return bg ? [rgbToHex(bg[0], bg[1], bg[2])] : [];
  const clusters = kmeans(pts, 4);
  const total = clusters.reduce((s, c) => s + c.n, 0);
  const out: string[] = [];
  for (const cl of clusters.sort((a, b) => b.n - a.n)) {
    if (cl.n / total < 0.12) continue;
    const hex = rgbToHex(cl.c[0], cl.c[1], cl.c[2]);
    if (out.some((o) => dist(o, hex) < 60)) continue;
    out.push(hex);
    if (out.length === 3) break;
  }
  return out;
}

function px(d: Uint8ClampedArray, w: number, x: number, y: number) {
  const i = (y * w + x) * 4;
  return [d[i], d[i + 1], d[i + 2], d[i + 3]];
}
function median(arr: number[][]) {
  return [0, 1, 2].map((k) => arr.map((p) => p[k]).sort((a, b) => a - b)[Math.floor(arr.length / 2)]);
}
function kmeans(pts: number[][], k: number) {
  let cents = Array.from({ length: k }, (_, i) => pts[Math.floor(((i + 0.5) / k) * pts.length)].slice(0, 3));
  let assign: number[] = [];
  for (let iter = 0; iter < 10; iter++) {
    assign = pts.map((p) => {
      let bi = 0, bd = Infinity;
      cents.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = i; } });
      return bi;
    });
    cents = cents.map((c, i) => {
      const mem = pts.filter((_, j) => assign[j] === i);
      if (!mem.length) return c;
      return [0, 1, 2].map((ch) => mem.reduce((s, p) => s + p[ch], 0) / mem.length);
    });
  }
  return cents.map((c, i) => ({ c, n: assign.filter((a) => a === i).length }));
}

export function loadImage(src: string | Blob): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    const url = typeof src === "string" ? src : URL.createObjectURL(src);
    img.onload = () => { res(img); if (typeof src !== "string") setTimeout(() => URL.revokeObjectURL(url), 1000); };
    img.onerror = () => rej(new Error("Couldn't load image"));
    img.src = url;
  });
}
