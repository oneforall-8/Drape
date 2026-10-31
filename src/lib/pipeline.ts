// Turning photos and links into wardrobe items.
import { findProduct, hasAI, importFromLink, reshoot, tagPhoto, uprightRotation, type Tags } from "./ai";
import { rotateBlob, tidy } from "./tidy";
import { colorName, extractColors } from "./colors";
import { getImageBlob, getState, putImage, saveItem, uid } from "./db";
import { fetchImageBlob, isImageUrl, prepareImage, removeBackground } from "./image";
import { readPage } from "./web";
import type { Category, Item, ItemStatus } from "./types";

const DEFAULTS: Record<Category, { warmth: number; formality: number }> = {
  top: { warmth: 2, formality: 2 }, bottom: { warmth: 3, formality: 2 }, dress: { warmth: 2, formality: 3 },
  outerwear: { warmth: 4, formality: 3 }, shoes: { warmth: 2, formality: 2 }, bag: { warmth: 1, formality: 3 }, accessory: { warmth: 1, formality: 2 },
};

export function blankItem(category: Category, status: ItemStatus = "owned"): Item {
  return {
    id: uid(), name: "", category, colors: [], pattern: "solid", seasons: [], occasions: ["casual"],
    ...DEFAULTS[category], status, favorite: false, tags: [], createdAt: Date.now(),
  };
}

function applyTags(item: Item, t: Tags): Item {
  return {
    ...item,
    name: t.name || item.name,
    category: t.category || item.category,
    subcategory: t.subcategory || item.subcategory,
    pattern: t.pattern || item.pattern,
    material: t.material || item.material,
    seasons: t.seasons?.length === 4 ? [] : t.seasons || item.seasons,
    occasions: t.occasions?.length ? t.occasions : item.occasions,
    formality: t.formality || item.formality,
    warmth: t.warmth || item.warmth,
    brand: t.brand || item.brand,
    colors: item.colors.length ? item.colors : (t.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)),
  };
}

const fallbackName = (it: Item) => `${it.colors[0] ? colorName(it.colors[0]) + " " : ""}${(it.subcategory || it.category).toLowerCase()}`;

export type Step = (msg: string) => void;

export async function ingestPhoto(file: Blob, opts: { category?: Category; status: ItemStatus }, step: Step = () => {}): Promise<Item> {
  const { settings } = getState();
  step("Preparing photo…");
  const prepared = await prepareImage(file);
  const originalId = await putImage(prepared);
  let item = blankItem(opts.category || "top", opts.status);
  item.originalImageId = originalId;
  item.imageId = originalId;

  // Tagging (AI) and cut-out (on-device) run side by side.
  const tagging = settings.autoTag && hasAI() ? tagPhoto(prepared).catch((e) => { step(`AI tagging skipped: ${e.message}`); return null; }) : Promise.resolve(null);
  let cutOK = false;
  if (settings.autoRemoveBg) {
    try {
      const cut = await removeBackground(prepared, step);
      item.imageId = await putImage(cut);
      cutOK = true;
    } catch (e) {
      console.warn("background removal failed", e);
      step("Couldn't cut out the background — keeping the original photo.");
    }
  }
  step("Reading colours…");
  try { item.colors = cutOK ? await extractColors((await getImageBlob(item.imageId!))!) : []; } catch { /* ignore */ }
  const tags = await tagging;
  if (tags) {
    if (!cutOK) item.colors = [];
    item = applyTags(item, tags);
    if (tags.searchQuery) item.notes = undefined;
  }
  if (opts.category && !tags) item.category = opts.category;
  // Tidy the cut-out: upright, straight, fewer creases, cleaner colour (on-device, free).
  if (settings.autoTidy !== false) {
    try {
      step("Straightening and smoothing…");
      const src = (await getImageBlob(item.imageId!))!;
      const t = await tidy(src, { category: item.category, rotation: tags?.uprightRotation });
      if (t.changed.length) {
        item.imageId = await putImage(t.blob);
        if (cutOK) item.colors = await extractColors(t.blob).catch(() => item.colors);
      }
    } catch (e) { console.warn("tidy failed", e); }
  }
  if (!item.colors.length) { try { item.colors = await extractColors(prepared); } catch { /* ignore */ } }
  if (!item.name) item.name = fallbackName(item);
  item.name = item.name.charAt(0).toUpperCase() + item.name.slice(1);
  await saveItem(item);
  return item;
}

export async function ingestLink(url: string, opts: { status: ItemStatus; category?: Category }, step: Step = () => {}): Promise<Item> {
  const { settings } = getState();
  url = url.trim();
  let item = blankItem(opts.category || "top", opts.status);
  item.sourceUrl = url;
  let imgUrl: string | undefined;

  if (isImageUrl(url)) {
    imgUrl = url;
  } else if (hasAI()) {
    step("Reading the product page with Claude…");
    const p = await importFromLink(url);
    item = applyTags(item, p);
    imgUrl = p.imageUrl;
    if (p.price) item.price = p.price;
    if (p.colors?.length) item.colors = p.colors;
  } else {
    // Free path, no AI: read the page with the free reader and take its title, photo and price.
    step("Reading the product page…");
    const page = await readPage(url);
    item.name = page.title.split(/\s[|–—-]\s/)[0].trim();
    imgUrl = page.images[0];
    if (page.price) item.price = page.price;
  }

  if (imgUrl) {
    step("Saving the product photo…");
    const blob = await fetchImageBlob(imgUrl, settings.proxyUrl);
    if (blob) {
      const prepared = await prepareImage(blob);
      item.originalImageId = await putImage(prepared);
      item.imageId = item.originalImageId;
      if (settings.autoRemoveBg) {
        try { item.imageId = await putImage(await removeBackground(prepared, step)); } catch { /* keep original */ }
      }
      if (!item.colors.length) { try { item.colors = await extractColors((await getImageBlob(item.imageId))!); } catch { /* ignore */ } }
    } else {
      // The shop blocks downloads from other sites: show the image directly from their server instead.
      item.imageUrl = imgUrl;
    }
  }
  if (!item.name) item.name = fallbackName(item);
  await saveItem(item);
  return item;
}

/** Re-cut an existing item's photo. */
export async function recut(item: Item, step: Step = () => {}) {
  if (item.reshotImageId && (await getImageBlob(item.reshotImageId))) {
    const next = { ...item, imageId: item.reshotImageId, imageUrl: undefined };
    await saveItem(next);
    return next;
  }
  const src = item.originalImageId ? await getImageBlob(item.originalImageId) : item.imageId ? await getImageBlob(item.imageId) : null;
  if (!src) throw new Error("No local photo to cut out.");
  let cut = await removeBackground(src, step);
  if (getState().settings.autoTidy !== false) cut = (await tidy(cut, { category: item.category }).catch(() => ({ blob: cut }))).blob;
  const imageId = await putImage(cut);
  const colors = await extractColors(cut).catch(() => item.colors);
  const next = { ...item, imageId, originalImageId: item.originalImageId || item.imageId, colors: colors.length ? colors : item.colors };
  await saveItem(next);
  return next;
}

/** Replace the photo with a product image chosen from Claude's search results. */
export async function applyProductImage(item: Item, imageUrlStr: string, extra: { pageUrl?: string; brand?: string; price?: string }) {
  const { settings } = getState();
  const blob = await fetchImageBlob(imageUrlStr, settings.proxyUrl);
  const next: Item = { ...item, originalImageId: item.originalImageId || item.imageId };
  if (blob) {
    next.imageId = await putImage(await prepareImage(blob));
    next.imageUrl = undefined;
  } else {
    next.imageId = undefined;
    next.imageUrl = imageUrlStr;
  }
  if (!next.sourceUrl && extra.pageUrl) next.sourceUrl = extra.pageUrl;
  if (!next.brand && extra.brand) next.brand = extra.brand;
  const price = Number(String(extra.price || "").replace(/[^0-9.]/g, ""));
  if (!next.price && price) next.price = price;
  await saveItem(next);
  return { item: next, saved: !!blob };
}

export async function findCleanPhoto(item: Item) {
  const src = item.originalImageId ? await getImageBlob(item.originalImageId) : item.imageId ? await getImageBlob(item.imageId) : null;
  if (!src) throw new Error("This piece has no local photo to search with.");
  const hint = [item.brand, item.name, item.subcategory, item.colors.map(colorName).join(" ")].filter(Boolean).join(", ");
  return findProduct(src, hint);
}

export async function aiRetag(item: Item) {
  const id = item.originalImageId || item.imageId;
  const src = id ? await getImageBlob(id) : null;
  if (!src) throw new Error("No local photo to analyse.");
  const t = await tagPhoto(src);
  const next = applyTags({ ...item, colors: item.colors }, t);
  await saveItem(next);
  return next;
}

// ---------- Photo fixes on existing pieces ----------
async function currentBlob(item: Item) {
  const b = item.imageId ? await getImageBlob(item.imageId) : null;
  if (!b) throw new Error("This piece has no local photo to edit.");
  return b;
}
async function replacePhoto(item: Item, blob: Blob) {
  const id = await putImage(blob);
  // Turning or tilting the AI photo updates the saved AI version too.
  const reshotImageId = item.reshotImageId && item.imageId === item.reshotImageId ? id : item.reshotImageId;
  const next = { ...item, imageId: id, reshotImageId, originalImageId: item.originalImageId || item.imageId, imageUrl: undefined };
  await saveItem(next);
  return next;
}

/** Turn the photo by a quarter turn or a small tilt (degrees clockwise). */
export async function rotatePiece(item: Item, deg: number) {
  return replacePhoto(item, await rotateBlob(await currentBlob(item), deg));
}

/** Upright (AI if available), straighten, soften creases and fix colour. */
export async function tidyPiece(item: Item, opts: { askAI?: boolean } = {}) {
  // AI re-shoots are already clean: just make sure the piece is showing it.
  if (item.reshotImageId && (await getImageBlob(item.reshotImageId))) {
    if (item.imageId === item.reshotImageId) return { item, changed: [] as string[] };
    const next = { ...item, imageId: item.reshotImageId, imageUrl: undefined };
    await saveItem(next);
    return { item: next, changed: ["using the AI photo"] };
  }
  const src = await currentBlob(item);
  let rotation: number | undefined;
  if (opts.askAI !== false && hasAI()) rotation = await uprightRotation(src).catch(() => undefined);
  const t = await tidy(src, { category: item.category, rotation });
  if (!t.changed.length) return { item, changed: t.changed };
  return { item: await replacePhoto(item, t.blob), changed: t.changed };
}

/** Paid AI re-shoot: a pressed, straight product photo of the same garment, then cut out. */
export async function reshootPiece(item: Item, step: Step = () => {}, opts: { again?: boolean } = {}) {
  // Reuse an earlier AI photo instead of paying again.
  if (!opts.again && item.reshotImageId && (await getImageBlob(item.reshotImageId))) {
    const next = { ...item, imageId: item.reshotImageId, imageUrl: undefined };
    await saveItem(next);
    return next;
  }
  step("Re-shooting with AI…");
  const src = (item.originalImageId && (await getImageBlob(item.originalImageId))) || (await currentBlob(item));
  const fresh = await reshoot(src);
  let out: Blob = fresh;
  try { out = await removeBackground(fresh, step); } catch { /* white background is fine too */ }
  const id = await putImage(out);
  const next = { ...item, imageId: id, reshotImageId: id, originalImageId: item.originalImageId || item.imageId, imageUrl: undefined };
  await saveItem(next);
  return next;
}

/**
 * Re-shoot several pieces. Pieces that already have an AI photo are reused for free.
 * Stops early on billing/quota/key problems (returned as `error`), skips single bad photos.
 */
export async function reshootMany(items: Item[], onProgress: (msg: string) => void = () => {}) {
  const fresh = items.filter((i) => !i.reshotImageId);
  const reuse = items.filter((i) => i.reshotImageId && i.imageId !== i.reshotImageId);
  for (const r of reuse) await reshootPiece(r).catch(() => {});
  let done = 0, failed = 0;
  let error: string | undefined;
  for (let i = 0; i < fresh.length; i++) {
    onProgress(`Re-shooting ${i + 1} of ${fresh.length}…`);
    try { await reshootPiece(fresh[i]); done++; }
    catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/free tier|billing|limit|key/i.test(msg)) { error = msg; break; }
      failed++;
      console.warn(e);
    }
  }
  return { done, reused: reuse.length, failed, error };
}

export const reshootCost = (items: Item[]) => items.filter((i) => !i.reshotImageId).length * 0.03;
