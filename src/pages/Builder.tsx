import { ArrowDownToLine, CalendarPlus, Check, Heart, LayoutGrid, Minus, Plus, RotateCcw, RotateCw, Trash2, Wand2, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ItemImg, OutfitBoard, autoLayout, label } from "../components/ui";
import { deleteOutfit, saveDay, saveOutfit, uid } from "../lib/db";
import { go, todayKey, toast, useStore, useWear, useWeather } from "../lib/hooks";
import { scoreCombo, seasonFor, suggest } from "../lib/rules";
import { CATEGORIES, CATEGORY_LABEL, OCCASIONS, OCCASION_LABEL, type Category, type LayoutSlot, type Occasion, type Outfit } from "../lib/types";
import { isWet } from "../lib/weather";

export default function Builder({ id, params }: { id?: string; params: URLSearchParams }) {
  const { items, outfits } = useStore();
  const existing = outfits.find((o) => o.id === id);
  const { wx, loc } = useWeather();
  const { last } = useWear();
  const owned = useMemo(() => items.filter((i) => i.status === "owned"), [items]);

  const [o, setO] = useState<Outfit>(() => existing ?? {
    id: uid(), name: "", itemIds: (params.get("with") || params.get("items") || "").split(",").filter((x) => items.some((i) => i.id === x)),
    favorite: false, source: "manual", occasion: "casual", createdAt: Date.now(),
  });
  const [sel, setSel] = useState<string | null>(null);
  const [tab, setTab] = useState<Category | "all">("all");
  const [planDate, setPlanDate] = useState(params.get("date") || "");
  const its = o.itemIds.map((x) => items.find((i) => i.id === x)!).filter(Boolean);
  const layout: LayoutSlot[] = o.layout?.length ? o.layout : autoLayout(its);
  const verdict = its.length > 1 ? scoreCombo(its) : null;

  const toggle = (itemId: string) => {
    if (o.itemIds.includes(itemId)) setO({ ...o, itemIds: o.itemIds.filter((x) => x !== itemId), layout: o.layout?.filter((s) => s.itemId !== itemId) });
    else {
      const it = items.find((i) => i.id === itemId)!;
      const slot = autoLayout([...its, it]).find((s) => s.itemId === itemId)!;
      setO({ ...o, itemIds: [...o.itemIds, itemId], layout: o.layout?.length ? [...o.layout, { ...slot, z: Math.max(0, ...o.layout.map((s) => s.z)) + 1 }] : undefined });
    }
  };
  const editSel = (fn: (s: LayoutSlot) => Partial<LayoutSlot>) => {
    if (!sel) return;
    setO({ ...o, layout: layout.map((s) => (s.itemId === sel ? { ...s, ...fn(s) } : s)) });
  };

  const complete = () => {
    const ctx = {
      occasion: o.occasion || "casual",
      season: seasonFor(new Date(), loc?.lat),
      temp: wx?.daily[0] ? (wx.daily[0].max * 2 + wx.daily[0].min) / 3 : undefined,
      wet: wx ? isWet(wx.code, wx.rainChance) : undefined,
      locked: o.itemIds,
      lastWorn: last,
      seed: Date.now(),
    };
    const s = suggest(owned, ctx, 1)[0];
    if (!s) { toast("Couldn't complete this look — try adding a top, bottom or dress first"); return; }
    setO({ ...o, itemIds: s.itemIds, layout: undefined });
    toast(s.reasons[0] || "Look completed");
  };

  const persist = async (extra?: Partial<Outfit>) => {
    if (!o.itemIds.length) { toast("Add some pieces first"); return null; }
    const next = { ...o, ...extra, name: o.name || `Look ${String(outfits.length + 1).padStart(2, "0")}`, layout };
    await saveOutfit(next);
    setO(next);
    return next;
  };

  const shown = owned.filter((i) => tab === "all" || i.category === tab);

  return (
    <div className="page">
      <div className="crumbs" style={{ marginBottom: 10 }}><a href="#/looks" className="muted" style={{ textDecoration: "none" }}>looks</a><span>{existing ? "edit" : "new look"}</span></div>
      <div className="split">
        <div>
          <input className="input" style={{ fontFamily: "var(--hand)", fontSize: 30 }} placeholder="name this look…" value={o.name} onChange={(e) => setO({ ...o, name: e.target.value })} />
          <div className="board-frame" style={{ marginTop: 10 }}>
            {its.length ? (
              <OutfitBoard items={its} layout={layout} edit selected={sel} onSelect={setSel} onChange={(l) => setO({ ...o, layout: l })} />
            ) : (
              <div className="board" style={{ display: "grid", placeItems: "center", textAlign: "center", padding: 30 }}>
                <div><p className="hand lg">pick pieces from your closet</p><p className="muted small">then drag them around to style the flat-lay</p></div>
              </div>
            )}
          </div>
          <div className="row" style={{ marginTop: 10, minHeight: 40 }}>
            {sel ? (
              <>
                <span className="hand">{label(items.find((i) => i.id === sel)!)}</span>
                <button className="iconbtn" aria-label="Smaller" onClick={() => editSel((s) => ({ w: Math.max(0.1, s.w - 0.04) }))}><Minus size={18} /></button>
                <button className="iconbtn" aria-label="Bigger" onClick={() => editSel((s) => ({ w: Math.min(0.9, s.w + 0.04) }))}><Plus size={18} /></button>
                <button className="iconbtn" aria-label="Rotate left" onClick={() => editSel((s) => ({ r: s.r - 6 }))}><RotateCcw size={18} /></button>
                <button className="iconbtn" aria-label="Rotate right" onClick={() => editSel((s) => ({ r: s.r + 6 }))}><RotateCw size={18} /></button>
                <button className="iconbtn" aria-label="Send to back" onClick={() => editSel(() => ({ z: Math.min(...layout.map((x) => x.z)) - 1 }))}><ArrowDownToLine size={18} /></button>
                <button className="iconbtn" aria-label="Remove" onClick={() => { toggle(sel); setSel(null); }}><X size={18} /></button>
              </>
            ) : <span className="muted small">{its.length ? "Tap a piece to resize, rotate or layer it. Drag to move." : ""}</span>}
          </div>
          {verdict && verdict.reasons.length > 0 && <p className="small" style={{ color: "var(--ink-2)" }}>— {verdict.reasons.join(" · ")}</p>}
          {verdict && verdict.score < 0 && <p className="small" style={{ color: "var(--danger)" }}>These colours or patterns may compete — the stylist rules would tone one down.</p>}
        </div>

        <div className="stack">
          <div className="field"><span>occasion</span>
            <div className="tabs">{OCCASIONS.map((x) => <button key={x} className={o.occasion === x ? "on" : ""} onClick={() => setO({ ...o, occasion: x as Occasion })}>{OCCASION_LABEL[x].toLowerCase()}</button>)}</div>
          </div>
          <div className="row">
            <button className="btn solid" onClick={async () => { const n = await persist(); if (n) { toast("Look saved"); if (!existing) go(`/look/${n.id}`); } }}>save look</button>
            <button className="btn" onClick={complete}><Wand2 size={15} /> {its.length ? "complete it" : "surprise me"}</button>
            <button className="btn ghost" onClick={() => setO({ ...o, layout: undefined })}><LayoutGrid size={15} /> tidy</button>
            <button className="iconbtn" aria-label="Favourite" onClick={() => setO({ ...o, favorite: !o.favorite })}><Heart size={20} fill={o.favorite ? "currentColor" : "none"} /></button>
          </div>
          <div className="row">
            <button className="btn sm" onClick={async () => { const n = await persist(); if (n) { await saveDay({ date: todayKey(), itemIds: n.itemIds, outfitId: n.id, worn: true }); toast("Logged as today's outfit"); } }}><Check size={14} /> wear today</button>
            <input type="date" className="input" style={{ width: 160, fontSize: 15 }} value={planDate} onChange={(e) => setPlanDate(e.target.value)} />
            <button className="btn sm" disabled={!planDate} onClick={async () => { const n = await persist(); if (n) { await saveDay({ date: planDate, itemIds: n.itemIds, outfitId: n.id, worn: planDate < todayKey() }); toast("Added to your plan"); } }}><CalendarPlus size={14} /> plan</button>
            {existing && <button className="btn sm danger" onClick={async () => { if (confirm("Delete this look?")) { await deleteOutfit(existing.id); go("/looks"); } }}><Trash2 size={14} /></button>}
          </div>

          <div className="tabs" style={{ marginTop: 10 }}>
            <button className={tab === "all" ? "on" : ""} onClick={() => setTab("all")}>all</button>
            {CATEGORIES.map((c) => <button key={c} className={tab === c ? "on" : ""} onClick={() => setTab(c)}>{CATEGORY_LABEL[c].toLowerCase()}</button>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))", gap: 10, maxHeight: 520, overflowY: "auto" }}>
            {shown.map((it) => (
              <button key={it.id} className="mini" onClick={() => toggle(it.id)} style={{ width: "auto", opacity: o.itemIds.includes(it.id) ? 0.35 : 1, position: "relative" }}>
                <div className="img-wrap" style={{ width: "100%" }}><ItemImg item={it} /></div>
                <span className="hand">{label(it)}</span>
                {o.itemIds.includes(it.id) && <Check size={18} style={{ position: "absolute", top: 4, right: 4 }} />}
              </button>
            ))}
            {!shown.length && <p className="muted small">Nothing here yet.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
