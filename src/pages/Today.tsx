import { Bookmark, Check, CloudRain, Shuffle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Hero } from "../components/Hero";
import { OutfitBoard, label } from "../components/ui";
import { saveDay, saveOutfit, uid } from "../lib/db";
import { go, todayKey, toast, useNumbers, useStore, useWear, useWeather } from "../lib/hooks";
import { suggest, seasonFor, type Suggestion } from "../lib/rules";
import { loadSampleWardrobe, sampleSvg } from "../lib/sample";
import { OCCASIONS, OCCASION_LABEL, type Occasion } from "../lib/types";
import { describe, fmtTemp, isWet } from "../lib/weather";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export default function Today() {
  const { items, settings, days } = useStore();
  const owned = useMemo(() => items.filter((i) => i.status === "owned"), [items]);
  const nums = useNumbers();
  const { wx, loc } = useWeather();
  const { last } = useWear();
  const [occasion, setOccasion] = useState<Occasion>(() => (new Date().getDay() % 6 === 0 ? "casual" : "work"));
  const [seed, setSeed] = useState(() => Date.now());
  const [looks, setLooks] = useState<Suggestion[]>([]);
  const [locks, setLocks] = useState<Record<number, string[]>>({});
  const looksRef = useRef<HTMLDivElement>(null);

  // A changing selection of pieces for the hero, mixing categories so it reads like a flat-lay.
  const ring = useMemo(() => {
    const shuffled = [...owned].sort((a, b) => ((a.id.charCodeAt(1) * seed) % 97) - ((b.id.charCodeAt(1) * seed) % 97));
    const byCat = new Map<string, typeof owned>();
    shuffled.forEach((it) => byCat.set(it.category, [...(byCat.get(it.category) || []), it]));
    const out: typeof owned = [];
    while (out.length < 12 && [...byCat.values()].some((l) => l.length)) for (const l of byCat.values()) { const it = l.shift(); if (it && out.length < 12) out.push(it); }
    return out;
  }, [owned, seed]);

  const ctx = useMemo(() => ({
    temp: wx ? (wx.daily[0] ? (wx.daily[0].max * 2 + wx.daily[0].min) / 3 : wx.feels) : undefined,
    wet: wx ? isWet(wx.code, wx.rainChance) : undefined,
    occasion,
    season: seasonFor(new Date(), loc?.lat),
    lastWorn: last,
  }), [wx, occasion, loc?.lat, last]);

  useEffect(() => {
    setLooks(suggest(owned, { ...ctx, seed }, 3));
    setLocks({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned.length, ctx.occasion, ctx.temp, ctx.wet, seed]);

  const reshuffle = (i: number) => {
    const locked = locks[i] || [];
    const others = looks.flatMap((l, k) => (k === i ? [] : l.itemIds));
    let next = suggest(owned, { ...ctx, locked, seed: Date.now() + i }, 6);
    next = next.filter((s) => s.itemIds.join() !== looks[i].itemIds.join());
    const pick = next.find((s) => s.itemIds.filter((x) => !locked.includes(x)).every((x) => !others.includes(x))) || next[0];
    if (pick) setLooks(looks.map((l, k) => (k === i ? pick : l)));
    else toast("No other combinations — add more pieces!");
  };

  const wear = async (s: Suggestion) => {
    await saveDay({ date: todayKey(), itemIds: s.itemIds, worn: true });
    toast("Logged as today's outfit");
  };
  const save = async (s: Suggestion, i: number) => {
    const id = uid();
    await saveOutfit({ id, name: `${OCCASION_LABEL[occasion]} look ${String(i + 1).padStart(2, "0")}`, itemIds: s.itemIds, occasion, favorite: false, source: "rules", notes: s.reasons.join(". "), createdAt: Date.now() });
    toast("Saved to looks");
  };

  if (owned.length === 0) return <Empty />;

  const today = days[todayKey()];
  const wxd = wx ? describe(wx.code) : null;

  return (
    <div className="page">
      <Hero pieces={ring.map((it) => ({ key: it.id, item: it, href: `#/item/${it.id}`, label: `${nums[it.id] ? parseInt(nums[it.id]) + " " : ""}${label(it)}` }))}>
        <h1 className="display">{greeting()}</h1>
        <p className="lede">
          {wx && loc ? <>{fmtTemp(wx.temp, settings.units)} and {wxd!.label.toLowerCase()} in {loc.name.split(",")[0]}{isWet(wx.code, wx.rainChance) ? " — take a layer for the rain." : "."} </> : <><a href="#/settings">Add your city</a> for weather-smart outfits. </>}
          {owned.length} pieces, {looks.length ? "a few ideas below." : "add tops, bottoms and shoes to get outfit ideas."}
        </p>
        <button className="circle hero-cta" onClick={() => looksRef.current?.scrollIntoView({ behavior: "smooth" })}>dress me</button>
      </Hero>


      <section className="section" ref={looksRef} style={{ scrollMarginTop: 20 }}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2 className="h2">Today's looks</h2>
          <button className="btn sm ghost" onClick={() => setSeed(Date.now())}><Shuffle size={15} /> new ideas</button>
        </div>
        <div className="tabs" style={{ marginBottom: 18 }}>
          {OCCASIONS.map((o) => <button key={o} className={o === occasion ? "on" : ""} onClick={() => setOccasion(o)}>{OCCASION_LABEL[o].toLowerCase()}</button>)}
        </div>
        {today?.worn && <p className="notice">You've logged an outfit for today. <a href="#/plan">See your plan</a>.</p>}
        {looks.length === 0 ? (
          <p className="notice">Not enough pieces for a full {OCCASION_LABEL[occasion].toLowerCase()} outfit yet. A look needs a top and a bottom (or a dress) — add a few more, or tag pieces with this occasion.</p>
        ) : (
          <>
            <p className="muted small" style={{ marginTop: 0 }}>Tap a piece to lock it, then shuffle to rebuild the rest around it.</p>
            <div className="looks">
              {looks.map((s, i) => {
                const its = s.itemIds.map((id) => owned.find((o) => o.id === id)!).filter(Boolean);
                return (
                  <article className="look" key={s.itemIds.join()}>
                    <OutfitBoard items={its} locked={locks[i]} onToggleLock={(id) => setLocks({ ...locks, [i]: (locks[i] || []).includes(id) ? locks[i].filter((x) => x !== id) : [...(locks[i] || []), id] })} />
                    <span className="hand" style={{ fontSize: 26, display: "block", textAlign: "right", transform: "rotate(-3deg)" }}>look {String(i + 1).padStart(2, "0")}</span>
                    {s.reasons.map((r) => <p key={r}>— {r}</p>)}
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn sm solid" onClick={() => wear(s)}><Check size={14} /> wear today</button>
                      <button className="btn sm" onClick={() => reshuffle(i)}><Shuffle size={14} /> shuffle</button>
                      <button className="btn sm ghost" onClick={() => save(s, i)}><Bookmark size={14} /> save</button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        )}
        {wx && isWet(wx.code, wx.rainChance) && <p className="muted small row" style={{ marginTop: 18 }}><CloudRain size={15} /> {wx.rainChance}% chance of rain — suggestions favour rain-friendly layers and shoes.</p>}
      </section>
    </div>
  );
}

function Empty() {
  const [busy, setBusy] = useState(false);
  const demo = [
    ["turtleneck", "#6b7a3f", "turtleneck"], ["shoulderbag", "#16181f", "bag"], ["skirt", "#1f3d33", "skirt"], ["cardigan", "#5a3424", "sweater"],
    ["loafers", "#5b3320", "shoes"], ["blazer", "#8a7a62", "blazer"], ["coat", "#151515", "jacket"], ["cardigan", "#8a5a2b", "sweater"],
    ["jeans", "#2c3a52", "jeans"], ["stripedtee", "#f2efe6", "top"], ["boots", "#121212", "boots"], ["scarf", "#7a2a2a", "scarf"],
  ];
  return (
    <div className="page">
      <Hero pieces={demo.map(([shape, color, name], i) => ({ key: `demo${i}`, label: `${i + 1} ${name}`, src: `data:image/svg+xml;utf8,${encodeURIComponent(sampleSvg(shape, color))}` }))}>
        <h1 className="display">Your wardrobe, curated</h1>
            <p className="lede">Photograph or link the clothes you own. Drape cuts them out, catalogues them and mixes them into outfits for the weather, the day and the occasion.</p>
            <div className="row" style={{ justifyContent: "center", marginTop: 22 }}>
              <button className="circle" onClick={() => go("/add")}>add your first piece</button>
            </div>
            <p className="small" style={{ marginTop: 14 }}>
              or <button className="link" disabled={busy} onClick={async () => { setBusy(true); await loadSampleWardrobe(); setBusy(false); toast("Sample wardrobe loaded — remove it any time in settings"); }}>{busy ? "loading…" : "explore with a sample wardrobe"}</button>
            </p>
      </Hero>
    </div>
  );
}
