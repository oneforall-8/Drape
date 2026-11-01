// Rule-based stylist. Works fully offline — no AI needed.
// It builds outfits as one top + bottom + shoes (or dress + shoes), a jacket or coat when the weather
// needs it, a second top layer only below 8°, and a watch plus at most one accessory that suits the day,
// then scores them on weather fit, occasion, colour harmony, pattern mixing, formality and rotation.

import { colorName, hexToHsl, isNeutral, pairScore } from "./colors";
import { MID_LAYERS, type Item, type Occasion, type Season } from "./types";

export interface StyleContext {
  temp?: number; // feels-like °C for the day
  wet?: boolean;
  occasion: Occasion;
  season: Season;
  locked?: string[];
  lastWorn?: Record<string, number>; // itemId -> days since last worn
  seed?: number;
}
export interface Suggestion {
  itemIds: string[];
  score: number;
  reasons: string[];
}

export type Role = "top" | "mid" | "bottom" | "dress" | "outer" | "shoes" | "bag" | "accessory";
export function roleOf(i: Item): Role {
  if (i.category === "top") return MID_LAYERS.includes((i.subcategory || "").toLowerCase()) ? "mid" : "top";
  if (i.category === "outerwear") return "outer";
  return i.category as Role;
}

const OCCASION_FORMALITY: Record<Occasion, number> = { casual: 2, work: 3.3, smart: 4, party: 3.4, sport: 1, lounge: 1 };

export function seasonFor(date = new Date(), lat = 30): Season {
  const m = date.getMonth(); // 0..11
  const north: Season[] = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"];
  const s = north[m];
  if (lat >= 0) return s;
  return ({ winter: "summer", summer: "winter", spring: "autumn", autumn: "spring" } as const)[s];
}

export function targetWarmth(t: number) {
  if (t >= 26) return 1;
  if (t >= 20) return 2;
  if (t >= 14) return 3;
  if (t >= 7) return 4;
  return 5;
}

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sub = (i: Item) => (i.subcategory || i.name || "").toLowerCase();
const occ = (i: Item): Occasion[] => (i.occasions.length ? i.occasions : ["casual"]);

/** Individual fitness of an item for the context. Returns -Infinity to exclude. */
function itemFit(i: Item, ctx: StyleContext, role: Role): { s: number; why?: string } {
  let s = 0;
  let why: string | undefined;
  const target = OCCASION_FORMALITY[ctx.occasion];
  const gap = Math.abs(i.formality - target);
  const matches = occ(i).includes(ctx.occasion);
  if (!matches && gap > 1.8 && role !== "bag" && role !== "accessory") return { s: -Infinity };
  if (ctx.occasion === "sport" && ["top", "bottom", "shoes"].includes(role) && !matches) return { s: -Infinity };
  s += matches ? 1.4 : -gap * 0.6;

  if (i.seasons.length && !i.seasons.includes(ctx.season)) s -= 0.8;

  if (ctx.temp !== undefined) {
    const t = ctx.temp;
    const tw = targetWarmth(t);
    if (role === "top" || role === "bottom" || role === "dress") {
      const want = Math.min(tw, 4);
      s -= Math.abs(i.warmth - want) * 0.55;
      if (t >= 25 && i.warmth >= 4) return { s: -Infinity };
      if (t < 8 && i.warmth <= 1) return { s: -Infinity };
    }
    if (role === "mid") s -= Math.abs(i.warmth - Math.max(3, tw)) * 0.4;
    if (role === "outer") {
      const want = t < 5 ? 5 : t < 10 ? 4 : t < 15 ? 3 : 2;
      s -= Math.abs(i.warmth - want) * 0.7;
      if (ctx.wet && /rain|trench|parka|waterproof|shell|anorak/.test(sub(i) + " " + i.tags.join(" "))) { s += 1.5; why = `${i.name} keeps the rain off`; }
    }
    if (role === "shoes") {
      const n = sub(i);
      if (ctx.wet && /sandal|suede|canvas|espadrille|slide/.test(n + " " + (i.material || ""))) s -= 1.5;
      if (t >= 24 && /sandal|slide|loafer/.test(n)) s += 0.6;
      if (t < 8 && /boot/.test(n)) { s += 0.8; why = "Boots for the cold"; }
      if (t >= 26 && /boot/.test(n)) s -= 1;
    }
  }

  const days = ctx.lastWorn?.[i.id];
  if (days !== undefined) {
    if (days < 2) s -= 2.2;
    else if (days < 5) s -= 0.8;
    else if (days > 30) { s += 0.5; why = why || `You haven't worn the ${i.name.toLowerCase()} in a while`; }
  } else if (ctx.lastWorn) {
    s += 0.3; // never worn — nudge it into rotation
  }
  if (i.favorite) s += 0.4;
  return { s, why };
}

interface Pools { [r: string]: { item: Item; fit: number; why?: string }[] }

function buildPools(items: Item[], ctx: StyleContext): Pools {
  const pools: Pools = {};
  for (const i of items) {
    if (i.status !== "owned") continue;
    const role = roleOf(i);
    const locked = ctx.locked?.includes(i.id);
    const f = itemFit(i, ctx, role);
    if (!locked && f.s === -Infinity) continue;
    (pools[role] ||= []).push({ item: i, fit: locked ? 5 : f.s, why: f.why });
    // "upper": every top, sweaters included, judged as the one top of the look.
    if (role === "mid") {
      const u = itemFit(i, ctx, "top");
      if (locked || u.s !== -Infinity) (pools.upper ||= []).push({ item: i, fit: locked ? 5 : u.s, why: u.why });
    } else if (role === "top") (pools.upper ||= []).push({ item: i, fit: locked ? 5 : f.s, why: f.why });
  }
  return pools;
}

/** Knitwear and sweatshirts: pieces that shouldn't be stacked on each other. */
const isKnit = (i: Item) => /sweater|sweatshirt|cardigan|hoodie|jumper|knit|half-zip|quarter-zip/.test(sub(i) + " " + i.name.toLowerCase());

/** What kind of accessory a piece is, from its type or name. */
type AccKind = "watch" | "belt" | "hat" | "warm" | "sun" | "other";
function accKind(i: Item): AccKind {
  const n = sub(i) + " " + i.name.toLowerCase();
  if (/watch/.test(n)) return "watch";
  if (/belt/.test(n)) return "belt";
  if (/beanie|scarf|glove/.test(n)) return "warm";
  if (/sunglass/.test(n)) return "sun";
  if (/cap|hat/.test(n)) return "hat";
  return "other";
}

function pick<T extends { fit: number }>(arr: T[] | undefined, r: () => number): T | undefined {
  if (!arr?.length) return undefined;
  // softmax-ish weighted random so better items show up more but not always
  const ws = arr.map((x) => Math.exp(Math.max(-6, Math.min(6, x.fit)) * 0.9));
  const tot = ws.reduce((a, b) => a + b, 0);
  let v = r() * tot;
  for (let k = 0; k < arr.length; k++) { v -= ws[k]; if (v <= 0) return arr[k]; }
  return arr[arr.length - 1];
}

export function scoreCombo(items: Item[], ctx?: StyleContext): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const visible = items.filter((i) => !["bag", "accessory"].includes(i.category));
  const main = visible.map((i) => i.colors[0]).filter(Boolean);

  // Colour harmony
  let pairSum = 0, pairs = 0, bestPair: { a: string; b: string; reason?: string; s: number } | null = null, clash = false;
  for (let a = 0; a < main.length; a++) for (let b = a + 1; b < main.length; b++) {
    const v = pairScore(main[a], main[b]);
    pairSum += v.score; pairs++;
    if (v.score < 0) clash = true;
    if (!bestPair || (v.score > bestPair.s && v.reason !== "neutrals")) bestPair = { a: main[a], b: main[b], reason: v.reason, s: v.score };
  }
  if (pairs) score += (pairSum / pairs) * 2.2;
  const loud = main.filter((c) => !isNeutral(c) && hexToHsl(c).s > 0.5);
  const uniqueLoud = new Set(loud.map(colorName));
  if (uniqueLoud.size > 2) { score -= 1.6; }
  if (clash) score -= 0.6;
  if (main.length && main.every(isNeutral)) reasons.push("Clean neutral palette — easy to accessorise");
  else if (bestPair && bestPair.s > 0) {
    const [na, nb] = [colorName(bestPair.a), colorName(bestPair.b)];
    if (na !== nb) {
      const text = {
        tonal: `${na} and ${nb} keep it tonal`,
        analogous: `${na} and ${nb} sit side by side on the colour wheel`,
        complementary: `${na} and ${nb} are a confident contrast`,
        "neutral-anchor": `${isNeutral(bestPair.a) ? na : nb} grounds the ${isNeutral(bestPair.a) ? nb.toLowerCase() : na.toLowerCase()}`,
        neutrals: "",
      }[bestPair.reason || "neutrals"];
      if (text) reasons.push(text);
    } else reasons.push(`Monochrome ${na.toLowerCase()} look`);
  }

  // Patterns: one statement piece max
  const patterned = visible.filter((i) => i.pattern !== "solid" && i.pattern !== "textured");
  if (patterned.length >= 2) score -= 1.3 * (patterned.length - 1);
  else if (patterned.length === 1) reasons.push(`The ${patterned[0].pattern} ${patterned[0].subcategory?.toLowerCase() || patterned[0].category} is the statement — everything else stays quiet`);

  // Formality coherence
  const f = visible.map((i) => i.formality);
  if (f.length > 1) {
    const spread = Math.max(...f) - Math.min(...f);
    if (spread > 2) score -= 1.6;
    else if (spread <= 1) score += 0.4;
  }

  // Weather notes
  if (ctx?.temp !== undefined) {
    const t = ctx.temp;
    const hasOuter = items.some((i) => i.category === "outerwear");
    if (t < 15 && hasOuter) reasons.push(`Layered for ${Math.round(t)}°`);
    else if (t >= 24) reasons.push(`Light pieces for ${Math.round(t)}°`);
  }
  return { score, reasons };
}

/**
 * Checks a finished look (for example one an AI put together) against the basics.
 * Returns what's wrong, or an empty list when the look is fine to show.
 */
export function lookProblems(items: Item[], ctx: { temp?: number; locked?: string[] } = {}): string[] {
  const p: string[] = [];
  const count = (c: string) => items.filter((i) => i.category === c).length;
  const tops = items.filter((i) => i.category === "top");
  const dress = count("dress");
  if (new Set(items.map((i) => i.id)).size !== items.length) p.push("a piece is used twice");
  if (items.some((i) => i.status !== "owned")) p.push("uses a piece that isn't owned");
  if (dress > 1) p.push("more than one dress");
  if (dress === 0 && (tops.length === 0 || count("bottom") !== 1)) p.push("needs one top and one bottom");
  if (dress === 1 && count("bottom") > 0) p.push("dress with a bottom");
  if (count("shoes") !== 1) p.push("needs exactly one pair of shoes");
  if (count("outerwear") > 1) p.push("more than one jacket");
  if (tops.length > 2 || (tops.length === 2 && !(ctx.temp !== undefined && ctx.temp < 10))) p.push("two tops when it isn't cold");
  if (tops.length === 2 && tops.every(isKnit)) p.push("knit over knit");
  const outer = items.find((i) => i.category === "outerwear");
  if (outer && isKnit(outer) && tops.some(isKnit)) p.push("knit over knit");
  const accs = items.filter((i) => i.category === "accessory");
  for (const k of ["watch", "belt", "hat"] as AccKind[]) if (accs.filter((a) => accKind(a) === k).length > 1) p.push(`two of a kind: ${k}`);
  if (accs.length > 3) p.push("too many accessories");
  const missing = (ctx.locked || []).filter((id) => !items.some((i) => i.id === id));
  if (missing.length) p.push("left out a locked piece");
  return p;
}

/** Generate a few distinct, good outfits. */
export function suggest(all: Item[], ctx: StyleContext, count = 4): Suggestion[] {
  const pools = buildPools(all, ctx);
  const r = rng(ctx.seed ?? Date.now());
  const locked = (ctx.locked || []).map((id) => all.find((i) => i.id === id)).filter(Boolean) as Item[];
  const lockedRoles = new Map(locked.map((i) => [roleOf(i), i]));
  const temp = ctx.temp;

  const canSeparates = !lockedRoles.has("dress") && (pools.top?.length || lockedRoles.has("top") || pools.mid?.length) && (pools.bottom?.length || lockedRoles.has("bottom"));
  const canDress = !lockedRoles.has("top") && !lockedRoles.has("bottom") && !lockedRoles.has("mid") && (pools.dress?.length || lockedRoles.has("dress"));
  if (!canSeparates && !canDress) return [];

  const lockOr = (role: Role) => {
    const li = lockedRoles.get(role);
    return li ? { item: li, fit: 5 } : pick(pools[role], r);
  };

  const seen = new Set<string>();
  const cands: Suggestion[] = [];
  for (let n = 0; n < 500; n++) {
    const parts: { item: Item; fit: number; why?: string }[] = [];
    const dressRoute = canDress && (!canSeparates || lockedRoles.has("dress") || r() < (pools.dress!.length / ((pools.top?.length || 0) + pools.dress!.length)) * 0.9);
    if (dressRoute) {
      const d = lockOr("dress"); if (!d) continue; parts.push(d);
    } else {
      // One top. A sweater or sweatshirt can be that top; a second top layer only when it's properly cold.
      const lockedTop = lockedRoles.get("top"), lockedMid = lockedRoles.get("mid");
      const top = lockedTop ? { item: lockedTop, fit: 5 } : lockedMid ? { item: lockedMid, fit: 5 } : pick(pools.upper, r);
      const bottom = lockOr("bottom");
      if (!top || !bottom) continue;
      parts.push(top, bottom);
      const cold = temp !== undefined && temp < 8;
      if (roleOf(top.item) === "top" && !isKnit(top.item) && (lockedMid || (cold && r() < 0.6))) { const m = lockOr("mid"); if (m) parts.push(m); }
    }
    const needOuter = lockedRoles.has("outer") || (temp !== undefined ? temp < 15 || !!ctx.wet || (temp < 19 && r() < 0.45) : r() < 0.25);
    if (needOuter) {
      // A cardigan or knit over another knit or a sweatshirt looks bulky: it goes over a shirt, tee or polo shirt.
      const knitUnder = parts.some((p) => p.item.category === "top" && isKnit(p.item));
      const o = lockedRoles.get("outer") ? lockOr("outer") : pick(pools.outer?.filter((x) => !(knitUnder && isKnit(x.item))), r);
      if (o) parts.push(o);
    }
    const shoes = lockOr("shoes"); if (shoes) parts.push(shoes);
    if (lockedRoles.has("bag") || r() < 0.55) { const b = lockOr("bag"); if (b) parts.push(b); }

    // Accessories: a watch most days, plus at most one piece that suits the look or the weather.
    const accs = pools.accessory || [];
    const ofKind = (...k: AccKind[]) => accs.filter((a) => k.includes(accKind(a.item)));
    const lockedAcc = locked.filter((i) => roleOf(i) === "accessory");
    if (!lockedAcc.some((i) => accKind(i) === "watch") && r() < 0.9) { const w = pick(ofKind("watch"), r); if (w) parts.push(w); }
    if (!lockedAcc.some((i) => accKind(i) !== "watch")) {
      const smart = OCCASION_FORMALITY[ctx.occasion] >= 3;
      const b = parts.find((p) => p.item.category === "bottom")?.item;
      const tailored = !!b && !/drawstring|jogger|cargo|short|legging/.test(sub(b) + " " + b.name.toLowerCase());
      let extra: AccKind[] = [];
      if (temp !== undefined && temp < 10) extra = ["warm"];
      else if (smart && tailored) extra = ["belt"];
      else if (temp !== undefined && temp >= 20) extra = ["sun", "hat"];
      else if (tailored) extra = ["belt"];
      if (extra.length && r() < 0.5) { const e = pick(ofKind(...extra), r); if (e) parts.push(e); }
    }
    // anything else locked (e.g. two accessories)
    for (const li of locked) if (!parts.some((p) => p.item.id === li.id)) parts.push({ item: li, fit: 5 });

    const ids = parts.map((p) => p.item.id);
    const key = [...ids].sort().join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const items = parts.map((p) => p.item);
    const combo = scoreCombo(items, ctx);
    const fit = parts.reduce((s, p) => s + p.fit, 0) / parts.length;
    const reasons = [...combo.reasons, ...parts.map((p) => p.why).filter(Boolean) as string[]];
    cands.push({ itemIds: ids, score: combo.score + fit * 1.5 + r() * 0.6, reasons: [...new Set(reasons)].slice(0, 3) });
  }

  // Keep the best, but make sure suggestions are actually different from each other.
  cands.sort((a, b) => b.score - a.score);
  const out: Suggestion[] = [];
  const core = (s: Suggestion) => s.itemIds.filter((id) => { const it = all.find((i) => i.id === id)!; return ["top", "bottom", "dress", "outerwear"].includes(it.category) && !ctx.locked?.includes(id); });
  // Greedy pick: best score, minus a penalty for re-using pieces already shown in earlier picks.
  const used = new Map<string, number>();
  const pool = cands.slice(0, 120);
  while (out.length < count && pool.length) {
    let bi = -1, bs = -Infinity;
    pool.forEach((c, k) => {
      const cc = core(c);
      const tooSimilar = out.some((o) => { const oc = core(o); const shared = cc.filter((x) => oc.includes(x)).length; return cc.length ? shared / cc.length > 0.5 : false; });
      if (tooSimilar) return;
      const reuse = c.itemIds.reduce((a, id) => a + (ctx.locked?.includes(id) ? 0 : used.get(id) || 0), 0);
      const adj = c.score - reuse * 0.9;
      if (adj > bs) { bs = adj; bi = k; }
    });
    if (bi < 0) break;
    const [pick] = pool.splice(bi, 1);
    out.push(pick);
    pick.itemIds.forEach((id) => used.set(id, (used.get(id) || 0) + 1));
  }
  for (const c of cands) { if (out.length >= count) break; if (!out.includes(c)) out.push(c); }
  return out;
}

/** For wishlist items: how many owned pieces would pair well, i.e. is it worth buying? */
export function pairingCount(item: Item, wardrobe: Item[]) {
  const roleA = roleOf(item);
  const compatible: Record<Role, Role[]> = {
    top: ["bottom", "outer", "shoes", "mid"], mid: ["top", "bottom", "outer", "shoes"], bottom: ["top", "mid", "outer", "shoes"],
    dress: ["outer", "shoes", "bag"], outer: ["top", "bottom", "dress", "mid"], shoes: ["bottom", "dress"],
    bag: ["dress", "top", "bottom"], accessory: ["top", "dress", "outer"],
  };
  const matches = wardrobe.filter((w) => {
    if (w.status !== "owned" || w.id === item.id) return false;
    if (!compatible[roleA].includes(roleOf(w))) return false;
    if (Math.abs(w.formality - item.formality) > 1.5) return false;
    const a = item.colors[0], b = w.colors[0];
    return !a || !b || pairScore(a, b).score > 0.3;
  });
  return matches;
}

/** Days since each item was last worn, from the calendar log. */
export function lastWornMap(days: Record<string, { date: string; itemIds: string[]; worn: boolean }>, today = new Date()) {
  const out: Record<string, number> = {};
  const t0 = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  for (const d of Object.values(days)) {
    if (!d.worn) continue;
    const [y, m, dd] = d.date.split("-").map(Number);
    const ago = Math.round((t0 - Date.UTC(y, m - 1, dd)) / 86_400_000);
    if (ago < 0) continue;
    for (const id of d.itemIds) if (out[id] === undefined || ago < out[id]) out[id] = ago;
  }
  return out;
}

export function wearCounts(days: Record<string, { itemIds: string[]; worn: boolean }>) {
  const out: Record<string, number> = {};
  for (const d of Object.values(days)) if (d.worn) for (const id of d.itemIds) out[id] = (out[id] || 0) + 1;
  return out;
}
