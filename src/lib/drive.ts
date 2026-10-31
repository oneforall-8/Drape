// Google Drive sync through a tiny Google Apps Script "web app" the user deploys from their own account.
// No Google Cloud project, no OAuth client, no repeated sign-ins: Drape talks to one private link.
//
// The script saves everything into a "Drape wardrobe" folder in the user's Drive:
//   drape-data.json   pieces, looks and calendar
//   img-<imageId>     one file per photo
// Every request carries a long random token baked into the user's copy of the script,
// so the link alone isn't enough to read or change anything.
// Each record has an updatedAt time; when two devices disagree, the newer edit wins.

import { getImageBlob, getState, getTombstones, hasImage, onDataChange, putImage, replaceData, saveSettings, type Tombstones } from "./db";
import type { DayEntry, Item, Outfit } from "./types";

const DATA = "drape-data.json";

export type SyncState = "off" | "idle" | "syncing" | "error";
let status: { state: SyncState; msg?: string } = { state: "off" };
const listeners = new Set<() => void>();
export const syncStatus = () => status;
export const onSyncStatus = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
function setStatus(state: SyncState, msg?: string) { status = { state, msg }; listeners.forEach((l) => l()); }

// ---------- The script the user pastes into script.google.com ----------
export function newToken() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(36).padStart(2, "0")).join("").slice(0, 32);
}

export function appsScript(token: string) {
  return `// Drape — saves your wardrobe to a "Drape wardrobe" folder in your Google Drive.
// Deploy: Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone.
// The token below is your private key. Don't share this script or its link.
const TOKEN = '${token}';
const FOLDER = 'Drape wardrobe';

function doGet() { return out_({ ok: true, app: 'drape' }); }

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (req.token !== TOKEN) return out_({ error: 'Wrong token — this link belongs to a different Drape setup.' });
    const folder = folder_();
    const find = function (name) { const it = folder.getFilesByName(name); return it.hasNext() ? it.next() : null; };
    if (req.action === 'ping') return out_({ ok: true, folder: folder.getUrl() });
    if (req.action === 'list') {
      const names = [], it = folder.getFiles();
      while (it.hasNext()) names.push(it.next().getName());
      return out_({ files: names, folder: folder.getUrl() });
    }
    if (req.action === 'get') {
      const f = find(req.name);
      if (!f) return out_({ missing: true });
      const b = f.getBlob();
      return out_(req.text ? { text: b.getDataAsString() } : { data: Utilities.base64Encode(b.getBytes()), mime: b.getContentType() });
    }
    if (req.action === 'put') {
      const old = find(req.name);
      if (req.text !== undefined) {
        if (old) old.setContent(req.text); else folder.createFile(req.name, req.text, 'application/json');
      } else {
        if (old) old.setTrashed(true);
        folder.createFile(Utilities.newBlob(Utilities.base64Decode(req.data), req.mime, req.name));
      }
      return out_({ ok: true });
    }
    if (req.action === 'delete') {
      const f = find(req.name);
      if (f) f.setTrashed(true);
      return out_({ ok: true });
    }
    return out_({ error: 'Unknown action' });
  } catch (err) {
    return out_({ error: String(err) });
  }
}

function folder_() {
  const it = DriveApp.getFoldersByName(FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
}

function out_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
`;
}

// ---------- Talking to the script ----------
async function call<T = any>(action: string, body: Record<string, unknown> = {}, conn = connection()): Promise<T> {
  if (!conn) throw new Error("Google Drive isn't connected.");
  let r: Response;
  try {
    // A plain-text body keeps this a "simple" request, which Apps Script accepts from any website.
    r = await fetch(conn.url, { method: "POST", body: JSON.stringify({ token: conn.token, action, ...body }) });
  } catch {
    throw new Error("Couldn't reach your Drive link. Check your connection, and that the script is deployed with access set to “Anyone”.");
  }
  const j = await r.json().catch(() => null);
  if (!j) throw new Error("Your Drive link didn't answer properly. Make sure you copied the Web app URL (ending in /exec).");
  if (j.error) throw new Error(/wrong token/i.test(j.error) ? "This link doesn't match. On a new device, paste the full sync link from your first device (Settings › Google Drive sync › copy sync link)." : j.error);
  return j as T;
}

function connection() {
  const s = getState().settings;
  return s.syncUrl && s.syncToken ? { url: s.syncUrl, token: s.syncToken } : null;
}

/** A single link for other devices: the web app URL with the token after a #. */
export function syncLink() {
  const c = connection();
  return c ? `${c.url}#${c.token}` : "";
}

/** Connect with a web app URL (from setup) or a full sync link (from another device). */
export async function connect(input: string, tokenIfMissing?: string) {
  const [rawUrl, hashToken] = input.trim().split("#");
  const url = rawUrl.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(url)) throw new Error("That doesn't look like an Apps Script link. It should start with https://script.google.com/macros/s/…");
  const token = hashToken || tokenIfMissing;
  if (!token) throw new Error("This link is missing its key. On your first device, copy the full sync link from Settings.");
  const res = await call<{ ok: boolean; folder: string }>("ping", {}, { url, token });
  await saveSettings({ syncUrl: url, syncToken: token, driveConnected: true, syncFolderUrl: res.folder });
  await syncNow();
}

export async function disconnect() {
  await saveSettings({ driveConnected: false, syncUrl: undefined });
  setStatus("off");
}

// ---------- Merge ----------
interface Snapshot { version: 1; items: Item[]; outfits: Outfit[]; days: DayEntry[]; tombstones: Tombstones; savedAt: number }

function mergeList<T>(a: T[], b: T[], key: (x: T) => string, dead: Record<string, number>): T[] {
  const m = new Map<string, T>();
  for (const x of [...a, ...b]) {
    const k = key(x);
    const cur = m.get(k) as (T & { updatedAt?: number }) | undefined;
    if (!cur || ((x as { updatedAt?: number }).updatedAt || 0) > (cur.updatedAt || 0)) m.set(k, x);
  }
  // A deletion wins unless the record was edited after it.
  return [...m.values()].filter((x) => !(key(x) in dead) || ((x as { updatedAt?: number }).updatedAt || 0) > dead[key(x)]);
}
function mergeTombs(a: Tombstones, b?: Tombstones): Tombstones {
  const out: Tombstones = { items: { ...a.items }, outfits: { ...a.outfits }, days: { ...a.days } };
  if (b) for (const k of ["items", "outfits", "days"] as const) for (const [id, t] of Object.entries(b[k] || {})) out[k][id] = Math.max(out[k][id] || 0, t);
  return out;
}

const blobToB64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1] || "");
  r.onerror = rej;
  r.readAsDataURL(b);
});
const b64ToBlob = (data: string, mime: string) => {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime || "application/octet-stream" });
};

// ---------- Sync ----------
let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = doSync()
    .catch((e) => setStatus("error", e instanceof Error ? e.message : String(e)))
    .finally(() => {
      running = null;
      if (again) { again = false; void syncNow(); }
    });
  return running;
}

async function doSync() {
  if (!getState().settings.driveConnected || !connection()) return;
  setStatus("syncing");
  const { files } = await call<{ files: string[] }>("list");
  const remoteRaw = files.includes(DATA) ? (await call<{ text?: string }>("get", { name: DATA, text: true })).text : undefined;
  let remote: Snapshot | null = null;
  try { remote = remoteRaw ? JSON.parse(remoteRaw) : null; } catch { remote = null; }

  const { items, outfits, days } = getState();
  const tombstones = mergeTombs(getTombstones(), remote?.tombstones);
  const merged: Snapshot = {
    version: 1,
    items: mergeList(items, remote?.items || [], (x) => x.id, tombstones.items),
    outfits: mergeList(outfits, remote?.outfits || [], (x) => x.id, tombstones.outfits),
    days: mergeList(Object.values(days), remote?.days || [], (x) => x.date, tombstones.days),
    tombstones,
    savedAt: Date.now(),
  };

  // Photos: upload what Drive is missing, download what this device is missing.
  const remoteImgs = new Set(files.filter((f) => f.startsWith("img-")).map((f) => f.slice(4)));
  const needed = new Set(merged.items.flatMap((i) => [i.imageId, i.originalImageId]).filter(Boolean) as string[]);
  let n = 0;
  for (const id of needed) {
    n++;
    const local = await hasImage(id);
    if (local && !remoteImgs.has(id)) {
      setStatus("syncing", `Uploading photos ${n}/${needed.size}`);
      const blob = await getImageBlob(id);
      if (blob) { await call("put", { name: `img-${id}`, mime: blob.type || "image/webp", data: await blobToB64(blob) }); remoteImgs.add(id); }
    } else if (!local && remoteImgs.has(id)) {
      setStatus("syncing", `Downloading photos ${n}/${needed.size}`);
      const r = await call<{ data?: string; mime?: string; missing?: boolean }>("get", { name: `img-${id}` });
      if (r.data) await putImage(b64ToBlob(r.data, r.mime || "image/webp"), id);
    }
  }

  // Save the merged data to Drive, then locally.
  await call("put", { name: DATA, text: JSON.stringify(merged) });
  // Re-merge with anything edited on this device while we were syncing (newer edits win; the next sync uploads them).
  const now = getState();
  const final = {
    ...merged,
    items: mergeList(now.items, merged.items, (x) => x.id, tombstones.items),
    outfits: mergeList(now.outfits, merged.outfits, (x) => x.id, tombstones.outfits),
    days: mergeList(Object.values(now.days), merged.days, (x) => x.date, tombstones.days),
  };
  const localKey = JSON.stringify([now.items, now.outfits, Object.values(now.days)]);
  const finalKey = JSON.stringify([final.items, final.outfits, final.days]);
  if (localKey !== finalKey) await replaceData(final);

  // Tidy: remove photos no longer used by any piece.
  for (const id of remoteImgs) if (!needed.has(id)) await call("delete", { name: `img-${id}` }).catch(() => {});

  await saveSettings({ lastSync: Date.now() });
  setStatus("idle");
}

// ---------- Background sync ----------
let timer: number | undefined;
let started = false;
export function startAutoSync() {
  if (started) return;
  started = true;
  if (getState().settings.driveConnected && connection()) void syncNow();
  else setStatus("off");
  onDataChange(() => {
    if (!getState().settings.driveConnected) return;
    clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(), 3000);
  });
  // Pick up changes from other devices when coming back to the app.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getState().settings.driveConnected) void syncNow();
  });
}

export const tapSync = () => syncNow();
