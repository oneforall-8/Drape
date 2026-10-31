import { Heart } from "lucide-react";
import { useState } from "react";
import { OutfitBoard } from "../components/ui";
import { go, useStore } from "../lib/hooks";
import { OCCASIONS, OCCASION_LABEL, type Occasion } from "../lib/types";

export default function Looks() {
  const { outfits, items } = useStore();
  const [occ, setOcc] = useState<Occasion | "all" | "fav">("all");
  const list = outfits.filter((o) => occ === "all" || (occ === "fav" ? o.favorite : o.occasion === occ));

  return (
    <div className="page">
      <div className="spread">
        <div className="crumbs"><span className="muted">looks</span><span>{occ === "all" ? "everything" : occ === "fav" ? "favourites" : OCCASION_LABEL[occ].toLowerCase()}</span></div>
        <a className="btn sm" href="#/stylist">ask the stylist</a>
      </div>
      <div className="tabs" style={{ margin: "14px 0 22px" }}>
        <button className={occ === "all" ? "on" : ""} onClick={() => setOcc("all")}>all {outfits.length}</button>
        <button className={occ === "fav" ? "on" : ""} onClick={() => setOcc("fav")}>favourites</button>
        {OCCASIONS.map((o) => <button key={o} className={occ === o ? "on" : ""} onClick={() => setOcc(o)}>{OCCASION_LABEL[o].toLowerCase()}</button>)}
      </div>

      {list.length === 0 ? (
        <div className="center" style={{ padding: "60px 0" }}>
          <p className="hand lg">no looks yet</p>
          <p className="muted">Build one by hand, save a suggestion from the today page, or ask the stylist.</p>
        </div>
      ) : (
        <div className="looks four">
          {list.map((o, i) => {
            const its = o.itemIds.map((id) => items.find((x) => x.id === id)!).filter(Boolean);
            return (
              <a key={o.id} className="look" href={`#/look/${o.id}`} style={{ textDecoration: "none" }}>
                <OutfitBoard items={its} layout={o.layout} />
                <div className="spread" style={{ marginTop: 4 }}>
                  <span className="hand" style={{ fontSize: 24 }}>{o.name || `look ${String(i + 1).padStart(2, "0")}`}</span>
                  {o.favorite && <Heart size={15} fill="currentColor" />}
                </div>
              </a>
            );
          })}
        </div>
      )}
      <button className="circle float" onClick={() => go("/look/new")}>new look</button>
    </div>
  );
}
