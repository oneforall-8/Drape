import { ExternalLink, Heart, RefreshCw, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Chips, Dots, ItemImg, Spinner } from "../components/ui";
import { hasAI, shoppingIdeas, type BuyIdea } from "../lib/ai";
import { saveItem, saveSettings, uid } from "../lib/db";
import { go, toast, useStore, useWeather } from "../lib/hooks";
import { paletteText } from "../lib/palette";
import { seasonFor } from "../lib/rules";
import { SHOP_REGIONS, SHOPS, type ShopFor, type ShopRegion } from "../lib/shops";
import type { Item } from "../lib/types";

// Ideas are kept on this device until the closet or colour profile changes, or you ask for new ones.
const CACHE = "drape.tobuy";
interface Cached { sig: string; at: number; ideas: BuyIdea[] }
const readCache = (): Cached | null => { try { return JSON.parse(localStorage.getItem(CACHE) || "null"); } catch { return null; } };
const writeCache = (c: Cached) => { try { localStorage.setItem(CACHE, JSON.stringify(c)); } catch { /* private mode */ } };

export default function ToBuy() {
  const { items, settings } = useStore();
  const { loc } = useWeather();
  const owned = useMemo(() => items.filter((i) => i.status === "owned"), [items]);
  const wishlist = useMemo(() => items.filter((i) => i.status === "wishlist").sort((a, b) => b.createdAt - a.createdAt), [items]);
  const region: ShopRegion = settings.shopRegion || "uk";
  const who: ShopFor = settings.shopFor || "men";
  const palette = paletteText(settings);
  const sig = `${owned.length}:${Math.max(0, ...owned.map((i) => i.updatedAt || i.createdAt))}:${palette}`;

  const [ideas, setIdeas] = useState<BuyIdea[]>(() => readCache()?.ideas || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const find = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await shoppingIdeas({ items: owned, palette, season: seasonFor(new Date(), loc?.lat), count: 8 });
      if (!res.length) throw new Error("The stylist didn't come back with any ideas. Try again.");
      setIdeas(res);
      writeCache({ sig, at: Date.now(), ideas: res });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // First visit, or the closet / colours changed since the last ideas: ask again.
  useEffect(() => {
    if (!hasAI() || owned.length < 3) return;
    if (readCache()?.sig !== sig) void find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  const onWishlist = (name: string) => wishlist.some((w) => w.name.toLowerCase() === name.toLowerCase());
  const addToWishlist = async (idea: BuyIdea) => {
    const now = Date.now();
    const item: Item = {
      id: uid(), name: idea.name, category: idea.category, subcategory: idea.subcategory || undefined, colors: idea.colors,
      pattern: "solid", seasons: [], occasions: [], formality: 3, warmth: 3, status: "wishlist", favorite: false,
      tags: ["to buy"], notes: idea.why, createdAt: now, updatedAt: now,
    };
    await saveItem(item);
    toast("Added to your wishlist");
  };

  const shopButtons = (query: string) => (
    <div className="row" style={{ gap: 8 }}>
      {SHOPS.map((s) => (
        <a key={s.id} className="btn sm" href={s.url(query, region, who)} target="_blank" rel="noreferrer">{s.name} <ExternalLink size={13} /></a>
      ))}
    </div>
  );

  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <h1 className="display" style={{ fontSize: "clamp(36px,7vw,72px)" }}>To buy</h1>
      <p className="lede" style={{ marginTop: 0 }}>Pieces that would add the most to your closet, with links to Uniqlo, Zara and H&amp;M.</p>

      <div className="row" style={{ gap: 18, marginBottom: 6 }}>
        <Chips options={["uk", "in"] as const} value={region} labels={SHOP_REGIONS} onChange={(v: ShopRegion) => saveSettings({ shopRegion: v })} />
        <Chips options={["men", "women"] as const} value={who} onChange={(v: ShopFor) => saveSettings({ shopFor: v })} />
      </div>

      <section className="section stack">
        <div className="spread">
          <h2 className="h2" style={{ margin: 0 }}>Ideas from your stylist</h2>
          {hasAI() && ideas.length > 0 && <button className="btn sm ghost" disabled={busy} onClick={find}>{busy ? <Spinner /> : <RefreshCw size={14} />} new ideas</button>}
        </div>
        {!hasAI() ? (
          <p className="notice">Connect a free AI in <a href="#/settings">settings</a> and your stylist will suggest what's missing from your closet. You can still search the shops below.</p>
        ) : owned.length < 3 ? (
          <p className="notice">Add a few more pieces first, so the stylist can see what's missing.</p>
        ) : (
          <>
            {busy && <p className="muted small row"><Spinner /> Looking for gaps in your closet…</p>}
            {err && !busy && <p className="muted small">Couldn't get ideas: {err} <button className="link" onClick={find}>try again</button></p>}
            {!palette && <p className="muted small" style={{ margin: 0 }}>Tip: set <a href="#/settings">your colours</a> and ideas will lean towards shades that suit you.</p>}
            <div className="buy-list">
              {ideas.map((idea) => {
                const pairs = idea.pairsWith.map((id) => owned.find((o) => o.id === id)).filter(Boolean) as Item[];
                const saved = onWishlist(idea.name);
                return (
                  <article className="buy-card" key={idea.name + idea.search}>
                    <div className="spread" style={{ alignItems: "flex-start", gap: 10 }}>
                      <div>
                        <p className="hand lg" style={{ margin: 0, lineHeight: 1.1 }}>{idea.name.toLowerCase()}</p>
                        <p className="muted small" style={{ margin: "4px 0 0" }}>{idea.subcategory || idea.category} {idea.colors.length > 0 && <Dots colors={idea.colors} />}</p>
                      </div>
                      <button className="iconbtn" disabled={saved} onClick={() => addToWishlist(idea)} aria-label={saved ? "On your wishlist" : "Add to wishlist"} title={saved ? "On your wishlist" : "Add to wishlist"}>
                        <Heart size={18} fill={saved ? "currentColor" : "none"} />
                      </button>
                    </div>
                    <p style={{ margin: "8px 0" }}>{idea.why}</p>
                    {pairs.length > 0 && (
                      <div className="buy-pairs" aria-label="Goes with">
                        <span className="muted small">goes with</span>
                        {pairs.map((p) => <a key={p.id} href={`#/item/${p.id}`} title={p.name}><ItemImg item={p} /></a>)}
                      </div>
                    )}
                    {shopButtons(idea.search)}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section className="section stack">
        <h2 className="h2" style={{ margin: 0 }}>Search the shops</h2>
        <form className="row" style={{ flexWrap: "nowrap" }} onSubmit={(e) => e.preventDefault()}>
          <input className="input" placeholder="e.g. navy merino crew neck" value={q} onChange={(e) => setQ(e.target.value)} />
          <Search size={18} className="muted" style={{ flex: "none" }} />
        </form>
        {q.trim() && shopButtons(q.trim())}
      </section>

      <section className="section stack">
        <div className="spread">
          <h2 className="h2" style={{ margin: 0 }}>Your wishlist</h2>
          <button className="btn sm ghost" onClick={() => go("/add?to=wishlist")}>+ add a link</button>
        </div>
        {wishlist.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>Tap the heart on an idea, or add a product link, and it'll be here.</p>
        ) : (
          <div className="buy-list">
            {wishlist.map((w) => (
              <article className="buy-card" key={w.id}>
                <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                  {(w.imageId || w.imageUrl) && <a className="buy-thumb" href={`#/item/${w.id}`}><ItemImg item={w} /></a>}
                  <div style={{ minWidth: 0 }}>
                    <a href={`#/item/${w.id}`} className="hand lg" style={{ textDecoration: "none", color: "inherit" }}>{w.name.toLowerCase()}</a>
                    {w.notes && <p className="muted small" style={{ margin: "4px 0 0" }}>{w.notes}</p>}
                  </div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {w.sourceUrl && <a className="btn sm solid" href={w.sourceUrl} target="_blank" rel="noreferrer">open product <ExternalLink size={13} /></a>}
                  {SHOPS.map((s) => <a key={s.id} className="btn sm" href={s.url(w.subcategory && !w.name.toLowerCase().includes(w.subcategory.toLowerCase()) ? `${w.name} ${w.subcategory}` : w.name, region, who)} target="_blank" rel="noreferrer">{s.name} <ExternalLink size={13} /></a>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
