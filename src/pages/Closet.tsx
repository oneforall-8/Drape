import { Search } from "lucide-react";
import { useMemo, useState } from "react";
import { CheckRow, Dropdown, Piece } from "../components/ui";
import { colorName, NAMED } from "../lib/colors";
import { go, useNumbers, useStore, useWear } from "../lib/hooks";
import { CATEGORIES, CATEGORY_LABEL, OCCASIONS, OCCASION_LABEL, SEASONS, type Category, type ItemStatus, type Occasion, type Season } from "../lib/types";

type Sort = "new" | "old" | "most" | "least" | "colour";

export default function Closet() {
  const { items } = useStore();
  const nums = useNumbers();
  const { counts } = useWear();
  const [status, setStatus] = useState<ItemStatus>("owned");
  const [cats, setCats] = useState<Category[]>([]);
  const [colors, setColors] = useState<string[]>([]);
  const [occ, setOcc] = useState<Occasion[]>([]);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [favs, setFavs] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("new");

  const inStatus = items.filter((i) => i.status === status);
  const usedColors = useMemo(() => {
    const s = new Set(inStatus.flatMap((i) => i.colors.slice(0, 1).map(colorName)));
    return NAMED.filter((n) => s.has(n.name));
  }, [inStatus]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let l = inStatus.filter((i) =>
      (!cats.length || cats.includes(i.category)) &&
      (!colors.length || i.colors.some((c) => colors.includes(colorName(c)))) &&
      (!occ.length || occ.some((o) => i.occasions.includes(o))) &&
      (!seasons.length || !i.seasons.length || seasons.some((s) => i.seasons.includes(s))) &&
      (!favs || i.favorite) &&
      (!needle || [i.name, i.brand, i.subcategory, i.material, ...i.tags, ...i.colors.map(colorName)].join(" ").toLowerCase().includes(needle)),
    );
    const hue = (h: string) => { const n = NAMED.findIndex((x) => x.name === colorName(h)); return n < 0 ? 99 : n; };
    l = [...l].sort((a, b) =>
      sort === "old" ? a.createdAt - b.createdAt :
      sort === "most" ? (counts[b.id] || 0) - (counts[a.id] || 0) :
      sort === "least" ? (counts[a.id] || 0) - (counts[b.id] || 0) :
      sort === "colour" ? hue(a.colors[0] || "#888") - hue(b.colors[0] || "#888") :
      b.createdAt - a.createdAt);
    return l;
  }, [inStatus, cats, colors, occ, seasons, favs, q, sort, counts]);

  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const crumb = cats.length === 1 ? CATEGORY_LABEL[cats[0]].toLowerCase() : cats.length > 1 ? `${cats.length} categories` : status === "owned" ? "everything" : status;
  const filtersOn = cats.length + colors.length + occ.length + seasons.length + (favs ? 1 : 0);

  return (
    <div className="page">
      <div className="spread">
        <div className="crumbs"><span className="muted">closet</span><span>{crumb}</span></div>
        <div className="row" style={{ gap: 20 }}>
          <Dropdown trigger={() => <>filter{filtersOn ? ` (${filtersOn})` : ""}</>}>
            {CATEGORIES.map((c) => <CheckRow key={c} on={cats.includes(c)} label={CATEGORY_LABEL[c].toLowerCase()} onClick={() => toggle(cats, c, setCats)} />)}
            <hr />
            {OCCASIONS.map((o) => <CheckRow key={o} on={occ.includes(o)} label={OCCASION_LABEL[o].toLowerCase()} onClick={() => toggle(occ, o, setOcc)} />)}
            <hr />
            {SEASONS.map((s) => <CheckRow key={s} on={seasons.includes(s)} label={s} onClick={() => toggle(seasons, s, setSeasons)} />)}
            <hr />
            <CheckRow on={favs} label="favourites" onClick={() => setFavs(!favs)} />
            {usedColors.length > 0 && <><hr /><div className="swatches">
              {usedColors.map((c) => <button key={c.name} title={c.name} className={"swatch" + (colors.includes(c.name) ? " on" : "")} style={{ background: c.hex }} onClick={() => toggle(colors, c.name, setColors)} />)}
            </div></>}
            {filtersOn > 0 && <button className="link" style={{ color: "#fff", justifySelf: "start", marginTop: 6 }} onClick={() => { setCats([]); setColors([]); setOcc([]); setSeasons([]); setFavs(false); }}>clear all</button>}
          </Dropdown>
          <Dropdown trigger={() => <>sort</>}>
            {(["new", "old", "most", "least", "colour"] as Sort[]).map((s) => (
              <CheckRow key={s} on={sort === s} label={{ new: "newest", old: "oldest", most: "most worn", least: "least worn", colour: "by colour" }[s]} onClick={() => setSort(s)} />
            ))}
          </Dropdown>
        </div>
      </div>

      <div className="spread" style={{ marginTop: 14 }}>
        <div className="tabs">
          {(["owned", "wishlist", "archived"] as ItemStatus[]).map((s) => (
            <button key={s} className={status === s ? "on" : ""} onClick={() => setStatus(s)}>
              {s === "owned" ? "my pieces" : s} <span className="muted small">{items.filter((i) => i.status === s).length}</span>
            </button>
          ))}
        </div>
        <label className="row" style={{ gap: 6, flexWrap: "nowrap", borderBottom: "1px solid var(--line)", minWidth: 180, flex: "0 1 260px" }}>
          <Search size={16} className="muted" />
          <input className="input" style={{ border: 0 }} placeholder="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
      </div>

      {inStatus.length === 0 ? (
        <div className="center" style={{ padding: "70px 0" }}>
          <p className="hand lg">{status === "wishlist" ? "nothing on the wishlist yet" : status === "archived" ? "nothing archived" : "your closet is empty"}</p>
          <p className="muted">{status === "wishlist" ? "Paste a product link on the add page and save it to your wishlist — Drape shows how many of your pieces it would go with." : "Add photos or links of your clothes to start."}</p>
          <button className="circle" style={{ marginTop: 12 }} onClick={() => go(`/add${status === "wishlist" ? "?to=wishlist" : ""}`)}>add {status === "wishlist" ? "a wish" : "pieces"}</button>
        </div>
      ) : list.length === 0 ? (
        <p className="center muted" style={{ padding: "60px 0" }}>Nothing matches those filters.</p>
      ) : (
        <div className="floor">
          {list.map((it) => <Piece key={it.id} item={it} num={nums[it.id]} href={`#/item/${it.id}`} />)}
        </div>
      )}
      <button className="circle float" onClick={() => go(`/add${status === "wishlist" ? "?to=wishlist" : ""}`)}>add a piece</button>
    </div>
  );
}
