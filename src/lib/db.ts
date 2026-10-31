import { openDB, type IDBPDatabase } from "idb";
import { DEFAULT_SETTINGS, type DayEntry, type Item, type Outfit, type Settings } from "./types";

/**
 * Everything lives in the browser (IndexedDB). Nothing is sent anywhere unless
 * the user turns on AI features, in which case only the relevant photo/text goes to Claude.
 */
let dbp: Promise<IDBPDatabase> | null = null;
function db() {
  if (!dbp) {
    dbp = openDB("drape", 1, {
      upgrade(d) {
        d.createObjectStore("items", { keyPath: "id" });
        d.createObjectStore("outfits", { keyPath: "id" });
        d.createObjectStore("days", { keyPath: "date" });
        d.createObjectStore("images");
        d.createObjectStore("kv");
      },
    });
  }
  return dbp;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---------- In-memory state + subscription (tiny store) ----------
export interface State {
  ready: boolean;
  items: Item[];
  outfits: Outfit[];
  days: Record<string, DayEntry>;
  settings: Settings;
}

// Called after any wardrobe data change (not settings) — used to trigger Drive sync.
const changeListeners = new Set<() => void>();
export const onDataChange = (fn: () => void) => { changeListeners.add(fn); return () => changeListeners.delete(fn); };
const changed = () => changeListeners.forEach((f) => f());

// Deleted record ids with the time of deletion, so a sync doesn't bring them back from another device.
export interface Tombstones { items: Record<string, number>; outfits: Record<string, number>; days: Record<string, number> }
let tomb: Tombstones = { items: {}, outfits: {}, days: {} };
export const getTombstones = () => tomb;
async function bury(kind: keyof Tombstones, id: string) {
  tomb = { ...tomb, [kind]: { ...tomb[kind], [id]: Date.now() } };
  await (await db()).put("kv", tomb, "tombstones");
}

let state: State = { ready: false, items: [], outfits: [], days: {}, settings: { ...DEFAULT_SETTINGS } };
const listeners = new Set<() => void>();
export const getState = () => state;
export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function guessCurrency() {
  const lang = (navigator.language || "en-US").toLowerCase();
  if (lang.endsWith("-in")) return "₹";
  if (lang.endsWith("-gb")) return "£";
  if (/^(de|fr|es|it|nl|pt|fi|el|sk|sl|et|lv|lt)/.test(lang) || lang.endsWith("-ie")) return "€";
  if (lang.endsWith("-jp")) return "¥";
  return "$";
}

export async function load() {
  const d = await db();
  const [items, outfits, days, settings, tombs] = await Promise.all([
    d.getAll("items") as Promise<Item[]>,
    d.getAll("outfits") as Promise<Outfit[]>,
    d.getAll("days") as Promise<DayEntry[]>,
    d.get("kv", "settings") as Promise<Settings | undefined>,
    d.get("kv", "tombstones") as Promise<Tombstones | undefined>,
  ]);
  tomb = { items: {}, outfits: {}, days: {}, ...(tombs || {}) };
  const dayMap: Record<string, DayEntry> = {};
  days.forEach((x) => (dayMap[x.date] = x));
  items.sort((a, b) => b.createdAt - a.createdAt);
  outfits.sort((a, b) => b.createdAt - a.createdAt);
  set({
    ready: true,
    items,
    outfits,
    days: dayMap,
    settings: { ...DEFAULT_SETTINGS, currency: guessCurrency(), ...(settings || {}), ...(settings && !(settings as { themeV2?: boolean }).themeV2 ? { theme: "light" as const } : {}) },
  });
}

// ---------- Items ----------
export async function saveItem(item: Item) {
  item = { ...item, updatedAt: Date.now() };
  const d = await db();
  await d.put("items", item);
  const exists = state.items.some((i) => i.id === item.id);
  set({ items: exists ? state.items.map((i) => (i.id === item.id ? item : i)) : [item, ...state.items] });
  changed();
}
export async function saveItems(items: Item[]) {
  const now = Date.now();
  items = items.map((i) => ({ ...i, updatedAt: now }));
  const d = await db();
  const tx = d.transaction("items", "readwrite");
  await Promise.all(items.map((i) => tx.store.put(i)));
  await tx.done;
  const ids = new Set(items.map((i) => i.id));
  set({ items: [...items, ...state.items.filter((i) => !ids.has(i.id))].sort((a, b) => b.createdAt - a.createdAt) });
  changed();
}
export async function deleteItem(id: string) {
  const d = await db();
  const item = state.items.find((i) => i.id === id);
  await d.delete("items", id);
  if (item?.imageId) await d.delete("images", item.imageId);
  if (item?.originalImageId) await d.delete("images", item.originalImageId);
  if (item?.reshotImageId) await d.delete("images", item.reshotImageId);
  // Remove from outfits; drop outfits that become empty.
  const outfits: Outfit[] = [];
  for (const o of state.outfits) {
    if (!o.itemIds.includes(id)) { outfits.push(o); continue; }
    const next = { ...o, itemIds: o.itemIds.filter((x) => x !== id), layout: o.layout?.filter((s) => s.itemId !== id), updatedAt: Date.now() };
    if (next.itemIds.length === 0) { await d.delete("outfits", o.id); await bury("outfits", o.id); }
    else { await d.put("outfits", next); outfits.push(next); }
  }
  await bury("items", id);
  set({ items: state.items.filter((i) => i.id !== id), outfits });
  changed();
}

// ---------- Outfits ----------
export async function saveOutfit(o: Outfit) {
  o = { ...o, updatedAt: Date.now() };
  const d = await db();
  await d.put("outfits", o);
  const exists = state.outfits.some((x) => x.id === o.id);
  set({ outfits: exists ? state.outfits.map((x) => (x.id === o.id ? o : x)) : [o, ...state.outfits] });
  changed();
}
export async function deleteOutfit(id: string) {
  const d = await db();
  await d.delete("outfits", id);
  await bury("outfits", id);
  set({ outfits: state.outfits.filter((o) => o.id !== id) });
  changed();
}

// ---------- Calendar ----------
export async function saveDay(e: DayEntry) {
  e = { ...e, updatedAt: Date.now() };
  const d = await db();
  await d.put("days", e);
  set({ days: { ...state.days, [e.date]: e } });
  changed();
}
export async function deleteDay(date: string) {
  const d = await db();
  await d.delete("days", date);
  await bury("days", date);
  const days = { ...state.days };
  delete days[date];
  set({ days });
  changed();
}

/** Replace local data with the result of a sync merge (no change notification, to avoid a loop). */
export async function replaceData(data: { items: Item[]; outfits: Outfit[]; days: DayEntry[]; tombstones: Tombstones }) {
  const d = await db();
  // Photos of pieces deleted on another device can go too.
  const keep = new Set(data.items.map((i) => i.id));
  const gone = state.items.filter((i) => !keep.has(i.id)).flatMap((i) => [i.imageId, i.originalImageId, i.reshotImageId]).filter(Boolean) as string[];
  for (const id of gone) await d.delete("images", id);
  const tx = d.transaction(["items", "outfits", "days", "kv"], "readwrite");
  await Promise.all([tx.objectStore("items").clear(), tx.objectStore("outfits").clear(), tx.objectStore("days").clear()]);
  for (const i of data.items) tx.objectStore("items").put(i);
  for (const o of data.outfits) tx.objectStore("outfits").put(o);
  for (const x of data.days) tx.objectStore("days").put(x);
  tx.objectStore("kv").put(data.tombstones, "tombstones");
  await tx.done;
  tomb = data.tombstones;
  const dayMap: Record<string, DayEntry> = {};
  data.days.forEach((x) => (dayMap[x.date] = x));
  set({
    items: [...data.items].sort((a, b) => b.createdAt - a.createdAt),
    outfits: [...data.outfits].sort((a, b) => b.createdAt - a.createdAt),
    days: dayMap,
  });
}

export async function hasImage(id: string) {
  return (await (await db()).getKey("images", id)) !== undefined;
}

/** Ask the browser not to clear this site's storage when space is low. */
export async function requestPersistence() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ignore */ }
}

// ---------- Settings ----------
export async function saveSettings(patch: Partial<Settings>) {
  const settings = { ...state.settings, ...patch, themeV2: true } as Settings;
  const d = await db();
  await d.put("kv", settings, "settings");
  set({ settings });
}

// ---------- Images ----------
const urlCache = new Map<string, string>();
export async function putImage(blob: Blob, id = uid()) {
  const d = await db();
  await d.put("images", blob, id);
  const old = urlCache.get(id);
  if (old) URL.revokeObjectURL(old);
  urlCache.delete(id);
  return id;
}
export async function getImageBlob(id: string): Promise<Blob | undefined> {
  const d = await db();
  return d.get("images", id);
}
export async function imageUrl(id: string): Promise<string | undefined> {
  const hit = urlCache.get(id);
  if (hit) return hit;
  const blob = await getImageBlob(id);
  if (!blob) return undefined;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

// ---------- Backup ----------
const toDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(b);
  });

export async function exportBackup(): Promise<Blob> {
  const d = await db();
  const keys = (await d.getAllKeys("images")) as string[];
  const images: Record<string, string> = {};
  for (const k of keys) {
    const b = await d.get("images", k);
    if (b) images[k] = await toDataUrl(b);
  }
  // Keys and sign-in details stay on this device only.
  const { apiKey: _k1, keys: _k2, reshootKey: _k3, driveConnected: _d1, lastSync: _d2, syncUrl: _d3, syncToken: _d4, driveImported: _d5, ...settings } = state.settings;
  const data = { app: "drape", version: 1, exportedAt: new Date().toISOString(), items: state.items, outfits: state.outfits, days: Object.values(state.days), settings, images };
  return new Blob([JSON.stringify(data)], { type: "application/json" });
}

export async function importBackup(file: File) {
  const data = JSON.parse(await file.text());
  if (data?.app !== "drape") throw new Error("This doesn't look like a Drape backup file.");
  const d = await db();
  for (const [k, v] of Object.entries<string>(data.images || {})) {
    const blob = await (await fetch(v)).blob();
    await d.put("images", blob, k);
  }
  const tx = d.transaction(["items", "outfits", "days"], "readwrite");
  for (const i of data.items || []) tx.objectStore("items").put(i);
  for (const o of data.outfits || []) tx.objectStore("outfits").put(o);
  for (const x of data.days || []) tx.objectStore("days").put(x);
  await tx.done;
  if (data.settings) await d.put("kv", { ...state.settings, ...data.settings, apiKey: state.settings.apiKey, keys: state.settings.keys, reshootKey: state.settings.reshootKey, driveConnected: state.settings.driveConnected, syncUrl: state.settings.syncUrl, syncToken: state.settings.syncToken }, "settings");
  await load();
  changed();
}

export async function wipeAll() {
  const d = await db();
  // Record deletions so a connected Drive doesn't restore them.
  for (const i of state.items) tomb.items[i.id] = Date.now();
  for (const o of state.outfits) tomb.outfits[o.id] = Date.now();
  for (const k of Object.keys(state.days)) tomb.days[k] = Date.now();
  await d.put("kv", tomb, "tombstones");
  for (const s of ["items", "outfits", "days", "images"]) await d.clear(s);
  await load();
  changed();
}
