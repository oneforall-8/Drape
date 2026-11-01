import { Archive, Check, Heart, ImagePlus, RefreshCw, RotateCcw, RotateCw, Scissors, Search, ShoppingBag, Sparkles, Trash2, Undo2, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Chips, ItemImg, Modal, Scale, Spinner, label } from "../components/ui";
import { canSearchWeb, hasAI, searchQueryFor, type ProductMatch } from "../lib/ai";
import { colorName, extractColors } from "../lib/colors";
import { deleteItem, getImageBlob, putImage, saveDay, saveItem } from "../lib/db";
import { go, money, todayKey, toast, pieceNo, useNumbers, useStore, useWear } from "../lib/hooks";
import { isImageUrl, prepareImage } from "../lib/image";
import { readPage, searchLinks } from "../lib/web";
import { aiRetag, applyProductImage, findCleanPhoto, recut, reshootPiece, rotatePiece, tidyPiece } from "../lib/pipeline";
import { pairingCount } from "../lib/rules";
import { CATEGORIES, CATEGORY_LABEL, OCCASIONS, OCCASION_LABEL, PATTERNS, SEASONS, SUBCATEGORIES, type Item } from "../lib/types";

export default function ItemPage({ id }: { id?: string }) {
  const { items, outfits, days, settings } = useStore();
  const stored = items.find((i) => i.id === id);
  const nums = useNumbers();
  const { counts, last } = useWear();
  const [draft, setDraft] = useState<Item | undefined>(stored);
  const [busy, setBusy] = useState<string | null>(null);
  const [matches, setMatches] = useState<ProductMatch[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [finder, setFinder] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setDraft(stored); }, [stored?.id, stored?.imageId, stored?.imageUrl, stored?.status]);

  // Auto-save edits after a short pause.
  useEffect(() => {
    if (!draft || !stored || JSON.stringify(draft) === JSON.stringify(stored)) return;
    const t = setTimeout(() => saveItem(draft), 450);
    return () => clearTimeout(t);
  }, [draft]);

  const pairs = useMemo(() => (draft ? pairingCount(draft, items) : []), [draft, items]);
  const inLooks = useMemo(() => outfits.filter((o) => id && o.itemIds.includes(id)), [outfits, id]);

  if (!draft || !stored) return <div className="page center" style={{ padding: 80 }}><p className="hand lg">piece not found</p><a href="#/closet">back to closet</a></div>;
  const set = (patch: Partial<Item>) => setDraft({ ...draft, ...patch });
  const worn = counts[draft.id] || 0;
  const cpw = draft.price ? draft.price / Math.max(worn, 1) : undefined;

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const wearToday = async () => {
    const k = todayKey();
    const d = days[k];
    await saveDay({ date: k, itemIds: [...new Set([...(d?.itemIds || []), draft.id])], worn: true, outfitId: d?.outfitId });
    toast(`Logged — worn ${worn + 1} time${worn ? "s" : ""}`);
  };

  const replacePhoto = async (f: File) => run("photo", async () => {
    const prepared = await prepareImage(f);
    const imageId = await putImage(prepared);
    const colors = await extractColors(prepared).catch(() => draft.colors);
    await saveItem({ ...draft, imageId, originalImageId: imageId, imageUrl: undefined, colors });
    toast("Photo replaced");
  });

  return (
    <div className="page">
      <div className="crumbs" style={{ marginBottom: 12 }}>
        <a className="muted" href="#/closet" style={{ textDecoration: "none" }}>closet</a>
        <span>{CATEGORY_LABEL[draft.category].toLowerCase()}</span>
      </div>
      <div className="split">
        <div>
          <div className="hero-img">
            <ItemImg item={stored} />
            {busy && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", background: "color-mix(in srgb, var(--paper) 60%, transparent)" }}><div className="row"><Spinner /> <span>{busy}</span></div></div>}
          </div>
          <p className="hand lg" style={{ width: "fit-content", margin: "12px 8px 0 auto", transform: "rotate(-3deg)" }}>{pieceNo(nums[draft.id])} {label(draft)}</p>
          <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
            <button className="btn sm" disabled={!!busy || (!stored.imageId && !stored.originalImageId)} onClick={() => run("Cutting out…", async () => { await recut(stored, (m) => setBusy(m)); toast("Background removed"); })}><Scissors size={14} /> cut out</button>
            <button className="btn sm" disabled={!!busy} onClick={() => {
              if (canSearchWeb()) run("Searching shops for this piece…", async () => setMatches(await findCleanPhoto(stored)));
              else setFinder(true);
            }}><Search size={14} /> find clean photo</button>
            <button className="btn sm ghost" disabled={!!busy} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> replace</button>
            {stored.originalImageId && stored.originalImageId !== stored.imageId && (
              <button className="btn sm ghost" disabled={!!busy} onClick={async () => { await saveItem({ ...stored, imageId: stored.originalImageId, imageUrl: undefined }); toast("Original photo restored"); }}><Undo2 size={14} /> original</button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && replacePhoto(e.target.files[0])} />
          </div>
          {stored.imageId && (
            <div className="row" style={{ justifyContent: "center", marginTop: 8 }}>
              <button className="iconbtn" title="Turn left" aria-label="Turn left" disabled={!!busy} onClick={() => run("Turning…", async () => { await rotatePiece(stored, -90); })}><RotateCcw size={18} /></button>
              <button className="iconbtn" title="Turn right" aria-label="Turn right" disabled={!!busy} onClick={() => run("Turning…", async () => { await rotatePiece(stored, 90); })}><RotateCw size={18} /></button>
              <button className="btn sm ghost" title="Tilt left a little" disabled={!!busy} onClick={() => run("Tilting…", async () => { await rotatePiece(stored, -3); })}>tilt ↺</button>
              <button className="btn sm ghost" title="Tilt right a little" disabled={!!busy} onClick={() => run("Tilting…", async () => { await rotatePiece(stored, 3); })}>tilt ↻</button>
              <button className="btn sm" disabled={!!busy} onClick={() => run("Tidying…", async () => {
                const r = await tidyPiece(stored);
                toast(r.changed.length ? r.changed.join(", ").replace(/^./, (c) => c.toUpperCase()) : "Already looks tidy");
              })}><Wand2 size={14} /> tidy up</button>
              {stored.reshotImageId && stored.imageId !== stored.reshotImageId && (
                <button className="btn sm solid" disabled={!!busy} onClick={() => run("Switching…", async () => { await reshootPiece(stored); toast("Showing the AI photo"); })}><Sparkles size={14} /> use AI photo</button>
              )}
              <button className="btn sm ghost" title="Paid: about 3p per photo with Google billing on" disabled={!!busy} onClick={() => {
                const again = !!stored.reshotImageId;
                if (again && !confirm("This piece already has an AI photo. Make a new one? (about 3p)")) return;
                run("Re-shooting with AI (takes ~15s)…", async () => {
                  await reshootPiece(stored, (m) => setBusy(m), { again });
                  toast("Re-shot — tap “original” to undo");
                });
              }}><Sparkles size={14} /> {stored.reshotImageId ? "re-shoot again" : "AI re-shoot"}</button>
            </div>
          )}
          {err && <p className="notice err" style={{ marginTop: 12 }}>{err}</p>}
        </div>

        <div className="stack">
          <input className="input h2" style={{ fontSize: "clamp(26px,4vw,38px)", fontFamily: "var(--serif-display)" }} value={draft.name} onChange={(e) => set({ name: e.target.value })} aria-label="Name" />
          <div className="facts">
            <div><b>{worn}</b><span>times worn</span></div>
            <div><b>{cpw !== undefined ? money(cpw, settings.currency) : "—"}</b><span>cost per wear</span></div>
            <div><b>{last[draft.id] === undefined ? "—" : last[draft.id] === 0 ? "today" : `${last[draft.id]}d`}</b><span>last worn</span></div>
          </div>
          <div className="row">
            {draft.status === "owned" ? (
              <>
                <button className="btn solid" onClick={wearToday}><Check size={15} /> wore it today</button>
                <button className="btn" onClick={() => go(`/look/new?with=${draft.id}`)}><Wand2 size={15} /> style it</button>
              </>
            ) : (
              <button className="btn solid" onClick={() => { set({ status: "owned" }); toast("Moved to your closet"); }}><ShoppingBag size={15} /> I bought it</button>
            )}
            <button className="iconbtn" aria-label="Favourite" onClick={() => set({ favorite: !draft.favorite })}><Heart size={20} fill={draft.favorite ? "currentColor" : "none"} /></button>
          </div>

          {draft.status === "wishlist" && (
            <p className="notice">Goes with <b>{pairs.length}</b> piece{pairs.length === 1 ? "" : "s"} you own. {pairs.length < 3 ? "Think twice — it may be hard to style." : pairs.length > 8 ? "A versatile buy." : "A decent match for your wardrobe."}</p>
          )}

          <label className="field"><span>category</span>
            <Chips options={CATEGORIES} value={draft.category} labels={Object.fromEntries(CATEGORIES.map((c) => [c, CATEGORY_LABEL[c].toLowerCase()]))} onChange={(c) => set({ category: c })} />
          </label>
          <label className="field"><span>type</span>
            <input className="input" list="subcats" value={draft.subcategory || ""} onChange={(e) => set({ subcategory: e.target.value })} placeholder="e.g. Shirt" />
            <datalist id="subcats">{SUBCATEGORIES[draft.category].map((s) => <option key={s} value={s} />)}</datalist>
          </label>
          <div className="field"><span>colours</span>
            <div className="row">
              {draft.colors.map((c, i) => (
                <label key={i} className="row" style={{ gap: 6 }}>
                  <input type="color" value={c} onChange={(e) => set({ colors: draft.colors.map((x, k) => (k === i ? e.target.value : x)) })} style={{ width: 28, height: 28, border: 0, padding: 0, background: "none" }} />
                  <span className="small">{colorName(c)}</span>
                  <button className="link small muted" onClick={() => set({ colors: draft.colors.filter((_, k) => k !== i) })}>×</button>
                </label>
              ))}
              {draft.colors.length < 3 && <button className="btn sm ghost" onClick={() => set({ colors: [...draft.colors, "#888888"] })}>+ colour</button>}
              <button className="btn sm ghost" onClick={async () => {
                const id2 = stored.imageId || stored.originalImageId;
                const b = id2 ? await getImageBlob(id2) : undefined;
                const cols = b ? await extractColors(b) : stored.imageUrl ? await extractColors(stored.imageUrl).catch(() => []) : [];
                if (cols.length) set({ colors: cols }); else toast("Couldn't read colours from this photo");
              }}><RefreshCw size={13} /> detect</button>
            </div>
          </div>
          <label className="field"><span>pattern</span><Chips options={PATTERNS} value={draft.pattern} onChange={(p) => set({ pattern: p })} /></label>
          <label className="field"><span>occasions</span><Chips multi options={OCCASIONS} value={draft.occasions} labels={Object.fromEntries(OCCASIONS.map((o) => [o, OCCASION_LABEL[o].toLowerCase()]))} onChange={(o) => set({ occasions: o })} /></label>
          <label className="field"><span>seasons <span className="muted">(none selected = all year)</span></span><Chips multi options={SEASONS} value={draft.seasons} onChange={(s) => set({ seasons: s })} /></label>
          <div className="grid2">
            <div className="field"><span>formality</span><Scale value={draft.formality} onChange={(n) => set({ formality: n })} left="relaxed" right="formal" /></div>
            <div className="field"><span>warmth</span><Scale value={draft.warmth} onChange={(n) => set({ warmth: n })} left="light" right="warm" /></div>
          </div>
          <div className="grid2">
            <label className="field"><span>brand</span><input className="input" value={draft.brand || ""} onChange={(e) => set({ brand: e.target.value })} /></label>
            <label className="field"><span>price ({settings.currency})</span><input className="input" inputMode="decimal" value={draft.price ?? ""} onChange={(e) => set({ price: e.target.value ? Number(e.target.value.replace(/[^0-9.]/g, "")) : undefined })} /></label>
            <label className="field"><span>size</span><input className="input" value={draft.size || ""} onChange={(e) => set({ size: e.target.value })} /></label>
            <label className="field"><span>material</span><input className="input" value={draft.material || ""} onChange={(e) => set({ material: e.target.value })} /></label>
          </div>
          <label className="field"><span>link</span><input className="input" value={draft.sourceUrl || ""} onChange={(e) => set({ sourceUrl: e.target.value })} placeholder="https://" /></label>
          {draft.sourceUrl && /^https?:/.test(draft.sourceUrl) && <a className="small" href={draft.sourceUrl} target="_blank" rel="noreferrer">open shop page ↗</a>}
          <label className="field"><span>notes</span><textarea className="textarea" value={draft.notes || ""} onChange={(e) => set({ notes: e.target.value })} /></label>
          <div className="row" style={{ marginTop: 6 }}>
            {hasAI() && <button className="btn sm ghost" disabled={!!busy} onClick={() => run("Tagging with AI…", async () => { const n = await aiRetag(stored); setDraft(n); toast("Tags updated"); })}><Sparkles size={14} /> re-tag with AI</button>}
            {draft.status !== "archived"
              ? <button className="btn sm ghost" onClick={() => { set({ status: "archived" }); toast("Archived — find it under closet › archived"); }}><Archive size={14} /> archive</button>
              : <button className="btn sm ghost" onClick={() => set({ status: "owned" })}><Undo2 size={14} /> restore</button>}
            {draft.status === "owned" && <button className="btn sm ghost" onClick={() => set({ status: "wishlist" })}>move to wishlist</button>}
            <button className="btn sm danger" onClick={async () => { if (confirm(`Delete “${draft.name}”? This can't be undone.`)) { await deleteItem(draft.id); go("/closet"); } }}><Trash2 size={14} /> delete</button>
          </div>
        </div>
      </div>

      {pairs.length > 0 && (
        <section className="section">
          <div className="spread"><h3 className="h3">Pairs well with</h3><span className="hand">{pairs.length} pieces</span></div>
          <div className="mini-row" style={{ marginTop: 12 }}>
            {pairs.slice(0, 16).map((p) => (
              <a key={p.id} className="mini" href={`#/item/${p.id}`} style={{ textDecoration: "none" }}>
                <div className="img-wrap"><ItemImg item={p} /></div>
                <span className="hand">{label(p)}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      {inLooks.length > 0 && (
        <section className="section">
          <h3 className="h3">In {inLooks.length} saved look{inLooks.length > 1 ? "s" : ""}</h3>
          <div className="row" style={{ marginTop: 10 }}>{inLooks.map((o) => <a key={o.id} className="btn sm" href={`#/look/${o.id}`}>{o.name}</a>)}</div>
        </section>
      )}

      {finder && <PhotoFinder item={stored} onClose={() => setFinder(false)} />}
      {matches && (
        <Modal wide onClose={() => setMatches(null)}>
          <h2 className="h2">Clean photos</h2>
          <p className="muted">Claude searched shops for this piece. Pick the photo to use — your original is kept.</p>
          {matches.length === 0 ? <p className="notice">No matches found. Adding the brand name in the details and searching again often helps.</p> : (
            <div className="queue">
              {matches.map((m) => (
                <MatchCard key={m.imageUrl} m={m} onPick={() => run("Saving photo…", async () => {
                  const r = await applyProductImage(stored, m.imageUrl, m);
                  setMatches(null);
                  toast(r.saved ? "Photo updated" : "Photo linked from the shop (it blocks downloads, so it needs internet to show)");
                })} />
              ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function MatchCard({ m, onPick }: { m: ProductMatch; onPick: () => void }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return (
    <div className="qcard">
      <div className="img-wrap"><img src={m.imageUrl} alt={m.title} onError={() => setBad(true)} referrerPolicy="no-referrer" /></div>
      <div className="small"><b>{m.brand}</b> {m.title}</div>
      <div className="spread small"><span className="muted">{m.price}</span><span className="hand">{m.confidence}</span></div>
      <div className="row">
        <button className="btn sm solid" onClick={onPick}>use this</button>
        {m.pageUrl && <a className="small" href={m.pageUrl} target="_blank" rel="noreferrer">shop ↗</a>}
      </div>
    </div>
  );
}

/** Free way to get a clean product photo: search for it, then paste the link you found. */
function PhotoFinder({ item, onClose }: { item: Item; onClose: () => void }) {
  const base = [item.brand, item.colors[0] ? colorName(item.colors[0]).toLowerCase() : "", item.name || item.subcategory].filter(Boolean).join(" ");
  const [q, setQ] = useState(base);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cands, setCands] = useState<string[] | null>(null);

  useEffect(() => {
    if (!hasAI()) return;
    let live = true;
    (async () => {
      setBusy("Writing a search query…");
      const id = item.originalImageId || item.imageId;
      const b = id ? await getImageBlob(id) : null;
      const better = await searchQueryFor(b || null, base);
      if (live) { setQ(better); setBusy(null); }
    })();
    return () => { live = false; };
  }, []);

  const use = async (url: string, pageUrl?: string) => {
    setBusy("Saving photo…"); setErr(null);
    try {
      const r = await applyProductImage(item, url, { pageUrl });
      toast(r.saved ? "Photo updated" : "Photo linked from the shop (it needs internet to show)");
      onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };
  const resolve = async () => {
    const u = link.trim();
    if (!/^https?:\/\//.test(u)) { setErr("Paste a full link starting with https://"); return; }
    if (isImageUrl(u)) return use(u);
    setBusy("Reading the page…"); setErr(null);
    try {
      const page = await readPage(u);
      if (!page.images.length) throw new Error("No photos found on that page — try copying the image address instead (right-click the photo › Copy image address).");
      setCands(page.images.slice(0, 12));
      setBusy(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };

  return (
    <Modal wide onClose={onClose}>
      <h2 className="h2">Find a clean photo</h2>
      <p className="muted">Search for this piece, then paste the product page or image link you find. Your original photo is kept.</p>
      <label className="field"><span>search for</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} /></label>
      <div className="row" style={{ marginTop: 10 }}>
        {searchLinks(q).map((l) => <a key={l.label} className="btn sm" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>)}
      </div>
      <label className="field" style={{ marginTop: 18 }}><span>paste the link you found</span>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" placeholder="https://… (product page or image address)" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && resolve()} />
          <button className="btn sm solid" disabled={!link.trim() || !!busy} onClick={resolve}>use</button>
        </div>
      </label>
      {busy && <p className="row small"><Spinner /> {busy}</p>}
      {err && <p className="notice err">{err}</p>}
      {cands && (
        <>
          <p className="small muted">Pick the photo to use:</p>
          <div className="queue">
            {cands.map((c) => <Cand key={c} url={c} onPick={() => use(c, link.trim())} />)}
          </div>
        </>
      )}
    </Modal>
  );
}

function Cand({ url, onPick }: { url: string; onPick: () => void }) {
  const [bad, setBad] = useState(false);
  if (bad) return null;
  return (
    <button className="qcard" style={{ background: "none", cursor: "pointer" }} onClick={onPick}>
      <div className="img-wrap"><img src={url} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} /></div>
    </button>
  );
}
