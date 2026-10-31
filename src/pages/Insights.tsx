import { useMemo } from "react";
import { ItemImg, label } from "../components/ui";
import { colorName, NAMED } from "../lib/colors";
import { money, useStore, useWear } from "../lib/hooks";
import { CATEGORIES, CATEGORY_LABEL } from "../lib/types";

export default function Insights() {
  const { items, days, settings } = useStore();
  const { counts, last } = useWear();
  const owned = items.filter((i) => i.status === "owned");

  const s = useMemo(() => {
    const value = owned.reduce((a, i) => a + (i.price || 0), 0);
    const priced = owned.filter((i) => i.price);
    const cpw = priced.length ? priced.reduce((a, i) => a + i.price! / Math.max(counts[i.id] || 0, 1), 0) / priced.length : undefined;
    const worn30 = owned.filter((i) => last[i.id] !== undefined && last[i.id] <= 30).length;
    const loggedDays = Object.values(days).filter((d) => d.worn).length;
    const palette: Record<string, number> = {};
    owned.forEach((i) => { if (i.colors[0]) { const n = colorName(i.colors[0]); palette[n] = (palette[n] || 0) + 1; } });
    const pal = Object.entries(palette).sort((a, b) => b[1] - a[1]);
    const byCat = CATEGORIES.map((c) => [c, owned.filter((i) => i.category === c).length] as const);
    const most = [...owned].filter((i) => counts[i.id]).sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0)).slice(0, 8);
    const forgotten = owned.filter((i) => (last[i.id] === undefined || last[i.id] > 45) && Date.now() - i.createdAt > 7 * 864e5).slice(0, 12);
    const neverWorn = owned.filter((i) => !counts[i.id]).length;
    return { value, cpw, worn30, loggedDays, pal, byCat, most, forgotten, neverWorn };
  }, [owned, counts, last, days]);

  if (!owned.length) return <div className="page center" style={{ padding: 80 }}><p className="hand lg">insights appear once you've added some pieces</p></div>;
  const maxCat = Math.max(...s.byCat.map((x) => x[1]), 1);

  return (
    <div className="page">
      <h1 className="display" style={{ fontSize: "clamp(36px,7vw,72px)" }}>Insights</h1>
      <div className="stats" style={{ marginTop: 24 }}>
        <div className="stat"><b>{owned.length}</b><span>pieces owned</span></div>
        <div className="stat"><b>{money(s.value, settings.currency)}</b><span>wardrobe value</span></div>
        <div className="stat"><b>{s.cpw !== undefined ? money(s.cpw, settings.currency) : "—"}</b><span>avg. cost per wear</span></div>
        <div className="stat"><b>{Math.round((s.worn30 / owned.length) * 100)}%</b><span>worn in the last 30 days</span></div>
      </div>
      {s.loggedDays < 5 && <p className="notice" style={{ marginTop: 18 }}>Log what you wear (today page → “wear today”, or the plan) — cost per wear and the “forgotten” list get smarter with every day you log.</p>}

      <div className="split section">
        <div>
          <h2 className="h3">Your palette</h2>
          <div className="bar" style={{ marginTop: 14 }}>
            {s.pal.map(([n, c]) => <div key={n} title={`${n} ${c}`} style={{ flex: c, background: NAMED.find((x) => x.name === n)?.hex }} />)}
          </div>
          <div className="legend">{s.pal.map(([n, c]) => <span key={n}><i style={{ background: NAMED.find((x) => x.name === n)?.hex }} />{n.toLowerCase()} {c}</span>)}</div>
          <p className="hand" style={{ marginTop: 16, whiteSpace: "normal" }}>
            {s.pal.length && ["Black", "White", "Grey", "Navy", "Beige", "Cream", "Charcoal", "Camel", "Brown", "Denim"].includes(s.pal[0][0])
              ? `mostly ${s.pal[0][0].toLowerCase()} — a neutral base that mixes easily`
              : s.pal.length ? `${s.pal[0][0].toLowerCase()} is your signature colour` : ""}
          </p>
        </div>
        <div>
          <h2 className="h3">By category</h2>
          <div style={{ marginTop: 14 }}>
            {s.byCat.map(([c, n]) => (
              <div key={c} className="hbar"><span>{CATEGORY_LABEL[c].toLowerCase()}</span><div className="track"><div className="fill" style={{ width: `${(n / maxCat) * 100}%` }} /></div><span className="muted">{n}</span></div>
            ))}
          </div>
        </div>
      </div>

      {s.most.length > 0 && (
        <section className="section">
          <h2 className="h3">Most worn</h2>
          <div className="mini-row" style={{ marginTop: 12 }}>
            {s.most.map((i) => (
              <a key={i.id} href={`#/item/${i.id}`} className="mini" style={{ textDecoration: "none" }}>
                <div className="img-wrap"><ItemImg item={i} /></div>
                <span className="hand">{counts[i.id]}× {label(i)}</span>
              </a>
            ))}
          </div>
        </section>
      )}
      {s.forgotten.length > 0 && (
        <section className="section">
          <div className="spread"><h2 className="h3">Forgotten pieces</h2><span className="muted small">not worn in 45+ days · {s.neverWorn} never worn</span></div>
          <p className="muted small">Lock one on the today page and shuffle — or let it go.</p>
          <div className="mini-row" style={{ marginTop: 12 }}>
            {s.forgotten.map((i) => (
              <a key={i.id} href={`#/item/${i.id}`} className="mini" style={{ textDecoration: "none" }}>
                <div className="img-wrap"><ItemImg item={i} /></div>
                <span className="hand">{label(i)}</span>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
