// Google Drive sync — the app's free backend.
//
// Everything is saved into a "Drape wardrobe" folder in the user's own Google Drive:
//   drape-data.json   pieces, looks and calendar
//   <imageId>.webp    one file per photo
// The app can only see files it created (drive.file scope), never the rest of the user's Drive.
// Each record carries an updatedAt time; when two devices disagree, the newer edit wins.

import { getImageBlob, getState, getTombstones, hasImage, onDataChange, putImage, replaceData, saveSettings, type Tombstones } from "./db";
import type { DayEntry, Item, Outfit } from "./types";

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER = "Drape wardrobe";
const DATA = "drape-data.json";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export type SyncState = "off" | "idle" | "syncing" | "needs-auth" | "error";
let status: { state: SyncState; msg?: string } = { state: "off" };
const listeners = new Set<() => void>();
export const syncStatus = () => status;
export const onSyncStatus = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
function setStatus(state: SyncState, msg?: string) { status = { state, msg }; listeners.forEach((l) => l()); }

class NeedsAuth extends Error {}

// ---------- Sign-in (Google Identity Services token flow) ----------
const TOKEN_KEY = "drape.drive.token";
let token: { value: string; exp: number } | null = (() => {
  try { const t = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null"); return t && t.exp > Date.now() ? t : null; } catch { return null; }
})();
const tokenValid = () => !!token && token.exp - 60_000 > Date.now();

let gisPromise: Promise<void> | null = null;
/** Load Google's sign-in script ahead of time, so the sign-in popup can open straight from a tap. */
export function prepareDrive() {
  if (!gisPromise) {
    gisPromise = new Promise<void>((res, rej) => {
      if ((window as any).google?.accounts?.oauth2) return res();
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => res();
      s.onerror = () => { gisPromise = null; rej(new Error("Couldn't load Google sign-in.")); };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

/** Must be called from a tap/click (browsers only allow sign-in popups then). */
export async function signIn(): Promise<void> {
  const clientId = getState().settings.driveClientId;
  if (!clientId) throw new Error("Add your Google OAuth client ID first (see the steps below).");
  await prepareDrive();
  await new Promise<void>((res, rej) => {
    const client = (window as any).google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => {
        if (r.error || !r.access_token) return rej(new Error(r.error_description || r.error || "Google sign-in failed."));
        token = { value: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        try { localStorage.setItem(TOKEN_KEY, JSON.stringify(token)); } catch { /* ignore */ }
        res();
      },
      error_callback: (e: { type?: string; message?: string }) => rej(new Error(e.type === "popup_closed" ? "Sign-in window was closed." : e.message || "Google sign-in failed.")),
    });
    client.requestAccessToken({ prompt: getState().settings.driveConnected ? "" : "consent" });
  });
}

export async function disconnect() {
  try { if (token) (window as any).google?.accounts?.oauth2?.revoke?.(token.value, () => {}); } catch { /* ignore */ }
  token = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  await saveSettings({ driveConnected: false });
  folderId = null;
  setStatus("off");
}

// ---------- Drive REST ----------
async function api(url: string, init: RequestInit = {}): Promise<Response> {
  if (!tokenValid()) throw new NeedsAuth();
  const r = await fetch(url, { ...init, headers: { ...(init.headers || {}), Authorization: `Bearer ${token!.value}` } });
  if (r.status === 401) { token = null; throw new NeedsAuth(); }
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new Error(`Google Drive error (${r.status}): ${j?.error?.message || r.statusText}`);
  }
  return r;
}

interface DFile { id: string; name: string; appProperties?: Record<string, string> }

let folderId: string | null = null;
async function ensureFolder(): Promise<string> {
  if (folderId) return folderId;
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const found = await (await api(`${API}/files?q=${q}&fields=files(id)&spaces=drive`)).json();
  if (found.files?.length) return (folderId = found.files[0].id);
  const created = await (await api(`${API}/files?fields=id`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER, mimeType: "application/vnd.google-apps.folder" }),
  })).json();
  return (folderId = created.id);
}

async function listFolder(folder: string): Promise<DFile[]> {
  const out: DFile[] = [];
  let page = "";
  do {
    const q = encodeURIComponent(`'${folder}' in parents and trashed=false`);
    const j = await (await api(`${API}/files?q=${q}&fields=nextPageToken,files(id,name,appProperties)&pageSize=1000${page ? `&pageToken=${page}` : ""}`)).json();
    out.push(...(j.files || []));
    page = j.nextPageToken || "";
  } while (page);
  return out;
}

function multipart(meta: object, body: Blob) {
  const b = "drape" + Math.random().toString(36).slice(2);
  return {
    body: new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${body.type || "application/octet-stream"}\r\n\r\n`, body, `\r\n--${b}--`]),
    type: `multipart/related; boundary=${b}`,
  };
}
async function createFile(meta: object, body: Blob) {
  const m = multipart(meta, body);
  return (await api(`${UPLOAD}/files?uploadType=multipart&fields=id`, { method: "POST", headers: { "Content-Type": m.type }, body: m.body })).json();
}
async function updateFile(id: string, body: Blob) {
  await api(`${UPLOAD}/files/${id}?uploadType=media`, { method: "PATCH", headers: { "Content-Type": body.type }, body });
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

// ---------- Sync ----------
let running: Promise<void> | null = null;
let again = false;

export function syncNow(): Promise<void> {
  if (running) { again = true; return running; }
  running = doSync()
    .catch((e) => {
      if (e instanceof NeedsAuth) setStatus("needs-auth", "Tap to reconnect Google Drive");
      else setStatus("error", e instanceof Error ? e.message : String(e));
    })
    .finally(() => {
      running = null;
      if (again) { again = false; void syncNow(); }
    });
  return running;
}

async function doSync() {
  if (!getState().settings.driveConnected) return;
  if (!tokenValid()) throw new NeedsAuth();
  setStatus("syncing");
  const folder = await ensureFolder();
  const files = await listFolder(folder);
  const dataFile = files.find((f) => f.name === DATA);
  const remote: Snapshot | null = dataFile ? await (await api(`${API}/files/${dataFile.id}?alt=media`)).json().catch(() => null) : null;

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
  const remoteImgs = new Map(files.filter((f) => f.appProperties?.imageId).map((f) => [f.appProperties!.imageId, f.id]));
  const needed = new Set(merged.items.flatMap((i) => [i.imageId, i.originalImageId]).filter(Boolean) as string[]);
  let n = 0;
  for (const id of needed) {
    n++;
    const local = await hasImage(id);
    if (local && !remoteImgs.has(id)) {
      setStatus("syncing", `Uploading photos ${n}/${needed.size}`);
      const blob = await getImageBlob(id);
      if (blob) {
        const ext = blob.type.split("/")[1]?.replace("svg+xml", "svg") || "img";
        const f = await createFile({ name: `${id}.${ext}`, parents: [folder], appProperties: { imageId: id } }, blob);
        remoteImgs.set(id, f.id);
      }
    } else if (!local && remoteImgs.has(id)) {
      setStatus("syncing", `Downloading photos ${n}/${needed.size}`);
      const blob = await (await api(`${API}/files/${remoteImgs.get(id)}?alt=media`)).blob();
      await putImage(blob, id);
    }
  }

  // Save the merged data to Drive, then locally.
  const json = new Blob([JSON.stringify(merged)], { type: "application/json" });
  if (dataFile) await updateFile(dataFile.id, json);
  else await createFile({ name: DATA, parents: [folder] }, json);
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
  for (const [id, fileId] of remoteImgs) if (!needed.has(id)) await api(`${API}/files/${fileId}`, { method: "DELETE" }).catch(() => {});

  await saveSettings({ lastSync: Date.now() });
  setStatus("idle");
}

/** Connect from a tap: sign in, then do a first full sync (merging anything already in Drive). */
export async function connectDrive() {
  await signIn();
  await saveSettings({ driveConnected: true });
  await syncNow();
}

// ---------- Background sync ----------
let timer: number | undefined;
let started = false;
export function startAutoSync() {
  if (started) return;
  started = true;
  const s = getState().settings;
  if (s.driveClientId) prepareDrive().catch(() => {});
  if (!s.driveConnected) setStatus("off");
  else if (tokenValid()) void syncNow();
  else setStatus("needs-auth", "Tap to sync with Google Drive");
  onDataChange(() => {
    if (!getState().settings.driveConnected) return;
    if (!tokenValid()) { setStatus("needs-auth", "Changes not backed up yet — tap to sync"); return; }
    clearTimeout(timer);
    timer = window.setTimeout(() => void syncNow(), 3000);
  });
  // Pick up changes from other devices when coming back to the app.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && getState().settings.driveConnected && tokenValid()) void syncNow();
  });
}

/** From a tap on the sync indicator: reconnect if needed, then sync. */
export async function tapSync() {
  if (!tokenValid()) await signIn();
  await syncNow();
}
