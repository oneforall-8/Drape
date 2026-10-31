import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ItemImg, Modal, OutfitBoard } from "../components/ui";
import { deleteDay, saveDay } from "../lib/db";
import { go, todayKey, toast, useItemImage, useStore, useWear, useWeather } from "../lib/hooks";
import { seasonFor, suggest, type Suggestion } from "../lib/rules";
import { OCCASIONS, OCCASION_LABEL, type DayEntry, type Item, type Occasion } from "../lib/types";
import { describe, fmtTemp, isWet } from "../lib/weather";

const DOW = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function Plan() {
  const { days, items, settings } = useStore();
  const { wx } = useWeather();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [open, setOpen] = useState<string | null>(null);
  const today = todayKey();

  const cells = useMemo(() => {
    const first = new Date(cursor);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);
  const weeks = cells[35].getMonth() !== cursor.getMonth() ? cells.slice(0, 35) : cells;

  const forecast = (k: string) => wx?.daily.find((d) => d.date === k);
  const monthWorn = Object.values(days).filter((d) => d.worn && d.date.startsWith(todayKey(cursor).slice(0, 7))).length;

  return (
    <div className="page">
      <div className="spread">
        <div className="crumbs"><span className="muted">plan</span><span>{cursor.toLocaleString(undefined, { month: "long", year: "numeric" }).toLowerCase()}</span></div>
        <div className="row">
          <span className="hand">{monthWorn} outfit{monthWorn === 1 ? "" : "s"} logged</span>
          <button className="iconbtn" aria-label="Previous month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}><ChevronLeft size={20} /></button>
          <button className="btn sm ghost" onClick={() => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}>today</button>
          <button className="iconbtn" aria-label="Next month" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}><ChevronRight size={20} /></button>
        </div>
      </div>
      <p className="muted small">Plan outfits ahead (with the forecast for the next 10 days), and log what you wore so Drape learns what you reach for.</p>

      <div className="cal" style={{ marginTop: 14 }}>
        {DOW.map((d) => <div key={d} className="dow">{d}</div>)}
        {weeks.map((d) => {
          const k = todayKey(d);
          const e = days[k];
          const f = forecast(k);
          return (
            <button key={k} className={"day" + (d.getMonth() !== cursor.getMonth() ? " out" : "") + (k === today ? " today" : "")} onClick={() => setOpen(k)}>
              <span className="n">{d.getDate()}</span>
              {f && <span className="wx">{fmtTemp(f.max, settings.units)}</span>}
              {e && (
                <div className="mini-collage">
                  {e.itemIds.slice(0, 6).map((id) => { const it = items.find((i) => i.id === id); return it ? <Tiny key={id} item={it} /> : null; })}
                </div>
              )}
              {e?.worn && <span className="worn-dot">worn</span>}
            </button>
          );
        })}
      </div>
      {open && <DaySheet date={open} entry={days[open]} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Tiny({ item }: { item: Item }) {
  const u = useItemImage(item);
  return u ? <img src={u} alt="" /> : null;
}

function DaySheet({ date, entry, onClose }: { date: string; entry?: DayEntry; onClose: () => void }) {
  const { items, outfits, settings } = useStore();
  const { wx, loc } = useWeather();
  const { last } = useWear();
  const [occasion, setOccasion] = useState<Occasion>("casual");
  const [ideas, setIdeas] = useState<Suggestion[] | null>(null);
  const f = wx?.daily.find((d) => d.date === date);
  const [y, m, dd] = date.split("-").map(Number);
  const dt = new Date(y, m - 1, dd);
  const isPast = date < todayKey();
  const its = (entry?.itemIds || []).map((id) => items.find((i) => i.id === id)!).filter(Boolean);
  const owned = items.filter((i) => i.status === "owned");

  const set = async (itemIds: string[], outfitId?: string) => {
    await saveDay({ date, itemIds, outfitId, worn: isPast || date === todayKey() ? !!entry?.worn || isPast : false });
    setIdeas(null);
    toast(isPast ? "Logged" : "Planned");
  };
  const gen = () => setIdeas(suggest(owned, {
    occasion, season: seasonFor(dt, loc?.lat), temp: f ? (f.max * 2 + f.min) / 3 : undefined, wet: f ? isWet(f.code, f.rainChance) : undefined, lastWorn: last, seed: Date.now(),
  }, 2));

  return (
    <Modal onClose={onClose} wide>
      <div className="spread">
        <h2 className="h2">{dt.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</h2>
        {f && <span className="hand lg">{fmtTemp(f.min, settings.units)}–{fmtTemp(f.max, settings.units)} · {describe(f.code).label.toLowerCase()}{f.rainChance > 40 ? ` · ${f.rainChance}% rain` : ""}</span>}
      </div>

      {its.length > 0 ? (
        <div className="split" style={{ marginTop: 16 }}>
          <OutfitBoard items={its} layout={outfits.find((o) => o.id === entry?.outfitId)?.layout} />
          <div className="stack">
            <p className="hand lg">{entry?.worn ? "worn" : "planned"}</p>
            <div className="row">
              {(isPast || date === todayKey()) && <button className="btn sm solid" onClick={() => saveDay({ ...entry!, worn: !entry!.worn })}>{entry?.worn ? "mark not worn" : "I wore this"}</button>}
              <button className="btn sm" onClick={() => go(entry?.outfitId ? `/look/${entry.outfitId}` : `/look/new?items=${entry!.itemIds.join(",")}&date=${date}`)}>edit look</button>
              <button className="btn sm danger" onClick={async () => { await deleteDay(date); onClose(); }}>clear day</button>
            </div>
          </div>
        </div>
      ) : <p className="muted">Nothing {isPast ? "logged" : "planned"} yet.</p>}

      <hr className="rule" />
      <h3 className="h3">{its.length ? "Swap it for…" : isPast ? "Log an outfit" : "Plan an outfit"}</h3>
      <div className="tabs" style={{ margin: "10px 0" }}>{OCCASIONS.map((o) => <button key={o} className={o === occasion ? "on" : ""} onClick={() => setOccasion(o)}>{OCCASION_LABEL[o].toLowerCase()}</button>)}</div>
      <div className="row">
        <button className="btn sm solid" onClick={gen}>suggest {f ? "for the forecast" : "outfits"}</button>
        <button className="btn sm" onClick={() => go(`/look/new?date=${date}`)}>build one</button>
      </div>
      {ideas && (ideas.length ? (
        <div className="looks" style={{ marginTop: 16 }}>
          {ideas.map((s) => (
            <div key={s.itemIds.join()} className="look">
              <OutfitBoard items={s.itemIds.map((id) => items.find((i) => i.id === id)!)} />
              {s.reasons.slice(0, 2).map((r) => <p key={r}>— {r}</p>)}
              <button className="btn sm solid" onClick={() => set(s.itemIds)}>use this</button>
            </div>
          ))}
        </div>
      ) : <p className="notice" style={{ marginTop: 12 }}>Not enough pieces for that occasion yet.</p>)}

      {outfits.length > 0 && (
        <>
          <h3 className="h3" style={{ marginTop: 24 }}>Or pick a saved look</h3>
          <div className="mini-row" style={{ marginTop: 10 }}>
            {outfits.map((o) => (
              <button key={o.id} className="mini" style={{ width: 120 }} onClick={() => set(o.itemIds, o.id)}>
                <div style={{ width: 120 }}><OutfitBoard items={o.itemIds.map((id) => items.find((i) => i.id === id)!).filter(Boolean)} layout={o.layout} /></div>
                <span className="hand">{o.name}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {(isPast || date === todayKey()) && owned.length > 0 && (
        <>
          <h3 className="h3" style={{ marginTop: 24 }}>Or tap the pieces you wore</h3>
          <div className="mini-row" style={{ marginTop: 10, flexWrap: "wrap" }}>
            {owned.map((it) => {
              const on = entry?.itemIds.includes(it.id);
              return (
                <button key={it.id} className="mini" style={{ opacity: on ? 1 : 0.55 }} onClick={() => saveDay({ date, worn: true, itemIds: on ? entry!.itemIds.filter((x) => x !== it.id) : [...(entry?.itemIds || []), it.id] })}>
                  <div className="img-wrap"><ItemImg item={it} /></div>
                  <span className="hand">{on ? "✓ " : ""}{(it.subcategory || it.category).toLowerCase()}</span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}
