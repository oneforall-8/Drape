// Free, on-device photo tidying for cut-out garments:
//  - turn sideways photos upright (AI hint when available, else a shape heuristic for trousers/dresses)
//  - straighten small tilts using the garment's main axis
//  - soften creases (reduce mid-frequency detail, keep edges and colour)
//  - gentle levels so dull phone photos look clean
// Nothing leaves the device.

import { loadImage } from "./colors";
import type { Category } from "./types";

type Canvas = HTMLCanvasElement;

async function toCanvas(src: Blob): Promise<Canvas> {
  const img = await loadImage(src);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  c.getContext("2d")!.drawImage(img, 0, 0);
  return c;
}

function toBlob(c: Canvas): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b && b.type === "image/webp" ? res(b) : c.toBlob((p) => (p ? res(p) : rej(new Error("encode failed"))), "image/png")), "image/webp", 0.92),
  );
}

/** Rotate by any angle (degrees, clockwise), growing the canvas so nothing is cropped. */
export function rotateCanvas(c: Canvas, deg: number): Canvas {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad)), sin = Math.abs(Math.sin(rad));
  const w = Math.round(c.width * cos + c.height * sin), h = Math.round(c.width * sin + c.height * cos);
  const o = document.createElement("canvas");
  o.width = w; o.height = h;
  const ctx = o.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(c, -c.width / 2, -c.height / 2);
  return o;
}

function trim(c: Canvas): Canvas {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 12) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x1 < 0) return c;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(width - 1, x1 + pad); y1 = Math.min(height - 1, y1 + pad);
  const o = document.createElement("canvas");
  o.width = x1 - x0 + 1; o.height = y1 - y0 + 1;
  o.getContext("2d")!.drawImage(c, x0, y0, o.width, o.height, 0, 0, o.width, o.height);
  return o;
}

interface Shape { transparent: boolean; tilt: number; elong: number; w: number; h: number; leftFill: number; rightFill: number; topFill: number; bottomFill: number; topRuns: number; bottomRuns: number; leftRuns: number; rightRuns: number }

/** Reads the garment's silhouette from the alpha channel. */
function shape(c: Canvas): Shape {
  const s = Math.min(1, 200 / Math.max(c.width, c.height));
  const w = Math.max(1, Math.round(c.width * s)), h = Math.max(1, Math.round(c.height * s));
  const t = document.createElement("canvas");
  t.width = w; t.height = h;
  const ctx = t.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(c, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  let n = 0, sx = 0, sy = 0, transparentPx = 0;
  const on = (x: number, y: number) => d[(y * w + x) * 4 + 3] > 128;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (on(x, y)) { n++; sx += x; sy += y; } else transparentPx++;
  }
  if (!n || transparentPx < w * h * 0.05) return { transparent: false, tilt: 0, elong: 1, w, h, leftFill: 0, rightFill: 0, topFill: 0, bottomFill: 0, topRuns: 0, bottomRuns: 0, leftRuns: 0, rightRuns: 0 };
  const mx = sx / n, my = sy / n;
  let cxx = 0, cyy = 0, cxy = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) { const dx = x - mx, dy = y - my; cxx += dx * dx; cyy += dy * dy; cxy += dx * dy; }
  cxx /= n; cyy /= n; cxy /= n;
  // Principal axis angle measured from vertical, in degrees.
  const theta = 0.5 * Math.atan2(2 * cxy, cxx - cyy); // from x-axis
  const tr = Math.sqrt(((cxx - cyy) / 2) ** 2 + cxy ** 2);
  const l1 = (cxx + cyy) / 2 + tr, l2 = (cxx + cyy) / 2 - tr;
  let fromVertical = (theta * 180) / Math.PI - 90;
  while (fromVertical > 90) fromVertical -= 180;
  while (fromVertical < -90) fromVertical += 180;
  // How solid each 12% edge band is (a waistband end is solid, a leg end has a gap).
  const band = (x0: number, x1: number, y0: number, y1: number) => {
    let a = 0, t2 = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { t2++; if (on(x, y)) a++; }
    return t2 ? a / t2 : 0;
  };
  const bw = Math.max(1, Math.round(w * 0.12)), bh = Math.max(1, Math.round(h * 0.12));
  // Measure bands inside the garment's bounding box.
  let bx0 = w, by0 = h, bx1 = 0, by1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
  // How many separate pieces of fabric cross each end (waistband = 1, two legs = 2).
  const runsAt = (line: (i: number) => boolean, len: number) => {
    let runs = 0, inRun = false, gap = 0;
    for (let i = 0; i < len; i++) {
      if (line(i)) { if (!inRun && (runs === 0 || gap > 1)) runs++; inRun = true; gap = 0; }
      else { if (inRun) gap = 1; else if (gap) gap++; inRun = false; }
    }
    return runs;
  };
  const medianRuns = (vals: number[]) => { const v = vals.filter((x) => x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };
  const rowRuns = (y0: number, y1: number) => { const out: number[] = []; for (let y = y0; y < y1; y++) out.push(runsAt((x) => on(bx0 + x, y), bx1 - bx0 + 1)); return medianRuns(out); };
  const colRuns = (x0: number, x1: number) => { const out: number[] = []; for (let x = x0; x < x1; x++) out.push(runsAt((y) => on(x, by0 + y), by1 - by0 + 1)); return medianRuns(out); };
  const eh = Math.max(1, Math.round((by1 - by0 + 1) * 0.06)), ew = Math.max(1, Math.round((bx1 - bx0 + 1) * 0.06));
  return {
    transparent: true,
    topRuns: rowRuns(by0 + 1, by0 + 1 + eh),
    bottomRuns: rowRuns(by1 - eh, by1),
    leftRuns: colRuns(bx0 + 1, bx0 + 1 + ew),
    rightRuns: colRuns(bx1 - ew, bx1),
    tilt: fromVertical,
    elong: Math.sqrt(Math.max(l1, 1e-6) / Math.max(l2, 1e-6)),
    w: bx1 - bx0 + 1, h: by1 - by0 + 1,
    leftFill: band(bx0, bx0 + bw, by0, by1 + 1),
    rightFill: band(bx1 + 1 - bw, bx1 + 1, by0, by1 + 1),
    topFill: band(bx0, bx1 + 1, by0, by0 + bh),
    bottomFill: band(bx0, bx1 + 1, by1 + 1 - bh, by1 + 1),
  };
}

/** Softens creases: keeps the garment's colour and outline but reduces crumpled mid-frequency detail. */
export function smoothCreases(c: Canvas, strength = 0.45) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const { data, width: w, height: h } = img;
  const r = Math.max(2, Math.round(Math.max(w, h) * 0.008));
  // Alpha-weighted blur (so the transparent background doesn't darken the edges).
  const ch = [new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h), new Float32Array(w * h)];
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    ch[0][i] = data[i * 4] * a; ch[1][i] = data[i * 4 + 1] * a; ch[2][i] = data[i * 4 + 2] * a; ch[3][i] = a;
  }
  const tmp = new Float32Array(w * h);
  const boxH = (src: Float32Array) => {
    for (let y = 0; y < h; y++) {
      let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / (2 * r + 1);
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    src.set(tmp);
  };
  const boxV = (src: Float32Array) => {
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let y = -r; y <= r; y++) acc += src[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) {
        tmp[y * w + x] = acc / (2 * r + 1);
        acc += src[Math.min(h - 1, y + r + 1) * w + x] - src[Math.max(0, y - r) * w + x];
      }
    }
    src.set(tmp);
  };
  for (const k of ch) for (let pass = 0; pass < 2; pass++) { boxH(k); boxV(k); }
  const keep = 1 - strength;
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3];
    if (a < 8) continue;
    const ba = ch[3][i] || 1e-6;
    for (let k = 0; k < 3; k++) {
      const blurred = ch[k][i] / ba;
      data[i * 4 + k] = Math.max(0, Math.min(255, blurred + (data[i * 4 + k] - blurred) * keep));
    }
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * Gentle auto-contrast on the garment only. Works on brightness, so colours keep their hue
 * (a grey stays grey), and the stretch is capped so dull photos lift without looking processed.
 */
export function autoLevels(c: Canvas, amount = 0.7) {
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  const hist = new Uint32Array(256);
  let n = 0;
  const luma = (i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { hist[Math.round(luma(i))]++; n++; }
  if (n < 100) return;
  const pct = (p: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * p) return v; } return 255; };
  const lo = pct(0.01), hi = pct(0.99);
  if (hi - lo < 8) return;
  // Widen the range a little toward black/white, at most 25% more contrast.
  const tLo = lo * 0.8, tHi = hi + (255 - hi) * 0.2;
  const scale = Math.min(1.25, (tHi - tLo) / (hi - lo));
  const mid = (lo + hi) / 2, tMid = (tLo + tHi) / 2;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 8) continue;
    const y = luma(i);
    const delta = ((y - mid) * scale + tMid - y) * amount;
    for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, d[i + k] + delta));
  }
  ctx.putImageData(img, 0, 0);
}

export interface TidyOptions {
  category: Category;
  rotation?: number; // clockwise quarter turn from AI (0/90/180/270)
  straighten?: boolean;
  smooth?: boolean;
  levels?: boolean;
}

/** Full tidy: upright → straighten → soften creases → levels → trim. */
export async function tidy(src: Blob, o: TidyOptions): Promise<{ blob: Blob; changed: string[] }> {
  let c = await toCanvas(src);
  const changed: string[] = [];
  let s = shape(c);
  const long = o.category === "bottom" || o.category === "dress";

  let quarter = o.rotation && [90, 180, 270].includes(o.rotation) ? o.rotation : 0;
  // No AI hint: trousers/dresses lying sideways are wider than tall; turn the solid (waistband) end to the top.
  if (!o.rotation && s.transparent && long && s.w > s.h * 1.2) {
    // The waistband end is one piece of fabric; the hem end shows two legs.
    if (s.rightRuns === 1 && s.leftRuns >= 2) quarter = 270;
    else if (s.leftRuns === 1 && s.rightRuns >= 2) quarter = 90;
    else quarter = s.rightFill >= s.leftFill ? 270 : 90;
  }
  if (quarter) { c = rotateCanvas(c, quarter); changed.push("turned upright"); s = shape(c); }
  // Upside-down trousers: the solid waistband should be at the top.
  const upsideDown = s.topRuns >= 2 && s.bottomRuns === 1 ? true : s.topRuns === 1 && s.bottomRuns >= 2 ? false : s.bottomFill > s.topFill * 1.35;
  if (!o.rotation && s.transparent && o.category === "bottom" && s.h > s.w && upsideDown) {
    c = rotateCanvas(c, 180); changed.push("flipped upright"); s = shape(c);
  }

  if (o.straighten !== false && s.transparent) {
    // Straighten when the garment has a clear long axis and is only slightly off vertical.
    const minElong = long ? 1.25 : 1.6;
    if (s.elong >= minElong && Math.abs(s.tilt) >= 1.5 && Math.abs(s.tilt) <= 25) {
      c = rotateCanvas(c, -s.tilt);
      changed.push(`straightened ${Math.round(Math.abs(s.tilt))}°`);
    }
  }
  if (s.transparent) {
    if (o.smooth !== false) { smoothCreases(c); changed.push("softened creases"); }
    if (o.levels !== false) autoLevels(c);
  }
  c = trim(c);
  return { blob: await toBlob(c), changed };
}

/** Manual rotate (any angle) of an existing photo. */
export async function rotateBlob(src: Blob, deg: number): Promise<Blob> {
  return toBlob(trim(rotateCanvas(await toCanvas(src), deg)));
}
