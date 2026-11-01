import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { getState, imageUrl, subscribe, type State } from "./db";
import { lastWornMap, wearCounts } from "./rules";
import type { Item } from "./types";
import { getWeather, type Weather } from "./weather";

export function useStore(): State {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** Resolves an item's local photo (blob) or remote fallback to a displayable URL. */
export function useItemImage(item?: Pick<Item, "imageId" | "imageUrl">) {
  const [url, setUrl] = useState<string | undefined>(item?.imageUrl);
  useEffect(() => {
    let live = true;
    if (item?.imageId) imageUrl(item.imageId).then((u) => live && setUrl(u || item.imageUrl));
    else setUrl(item?.imageUrl);
    return () => { live = false; };
  }, [item?.imageId, item?.imageUrl]);
  return url;
}

// ---------- Hash router ----------
export function useRoute() {
  const [hash, setHash] = useState(() => location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => { setHash(location.hash.slice(1) || "/"); window.scrollTo({ top: 0 }); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const [path, query = ""] = hash.split("?");
  const parts = path.split("/").filter(Boolean);
  return { path, parts, params: new URLSearchParams(query) };
}
export const go = (to: string) => { location.hash = to; };

// ---------- Derived data ----------
export function useWear() {
  const { days } = useStore();
  return useMemo(() => ({ counts: wearCounts(days), last: lastWornMap(days) }), [days]);
}

/** Catalogue numbers like "014", in order of when pieces were added. */
/** A piece's catalogue number for labels: "026" → "#26" (so "#26 sneakers" doesn't read as 26 pairs). */
export const pieceNo = (n?: string) => (n ? `#${parseInt(n, 10)}` : "");

export function useNumbers() {
  const { items } = useStore();
  return useMemo(() => {
    const m: Record<string, string> = {};
    [...items].sort((a, b) => a.createdAt - b.createdAt).forEach((it, i) => (m[it.id] = String(i + 1).padStart(3, "0")));
    return m;
  }, [items]);
}

export function useWeather() {
  const { settings } = useStore();
  const loc = settings.location;
  const [wx, setWx] = useState<Weather | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!loc) { setWx(null); return; }
    let live = true;
    getWeather(loc.lat, loc.lon).then((w) => live && setWx(w)).catch((e) => live && setErr(String(e.message || e)));
    return () => { live = false; };
  }, [loc?.lat, loc?.lon]);
  return { wx, err, loc };
}

// ---------- Toasts ----------
type ToastFn = (msg: string) => void;
let toastListener: ToastFn | null = null;
export const toast: ToastFn = (m) => toastListener?.(m);
export function useToastHost() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: number | undefined;
    toastListener = (m) => { setMsg(m); clearTimeout(t); t = window.setTimeout(() => setMsg(null), 2600); };
    return () => { toastListener = null; clearTimeout(t); };
  }, []);
  return msg;
}

export function hashNum(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

export const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function money(n: number | undefined, cur: string) {
  if (n === undefined || n === null || isNaN(n)) return "—";
  const v = n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(n % 1 ? 2 : 0);
  return `${cur}${v}`;
}
