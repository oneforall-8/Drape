import { ArrowUp, Bookmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OutfitBoard, Spinner } from "../components/ui";
import { askStylist, hasAI, wardrobeDigest, type StylistReply } from "../lib/ai";
import { paletteText } from "../lib/palette";
import { saveOutfit, uid } from "../lib/db";
import { toast, useStore, useWear, useWeather } from "../lib/hooks";
import { describe, fmtTemp } from "../lib/weather";

interface Turn { role: "user" | "assistant"; text: string; outfits?: StylistReply["outfits"] }

const PROMPTS = [
  "What should I wear to a friend's wedding this weekend?",
  "Plan 5 work outfits for next week without repeating.",
  "Pack a carry-on capsule for 4 days somewhere warm.",
  "Which pieces am I neglecting, and how do I style them?",
  "What one item would unlock the most new outfits?",
];

export default function Stylist() {
  const { items, settings } = useStore();
  const { counts } = useWear();
  const { wx, loc } = useWeather();
  const [turns, setTurns] = useState<Turn[]>(() => { try { return JSON.parse(sessionStorage.getItem("drape.chat") || "[]"); } catch { return []; } });
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { try { sessionStorage.setItem("drape.chat", JSON.stringify(turns)); } catch { /* ignore */ } endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [turns]);

  if (!hasAI()) {
    return (
      <div className="page center" style={{ paddingTop: 60, maxWidth: 680, margin: "0 auto" }}>
        <h1 className="display" style={{ fontSize: "clamp(36px,7vw,72px)" }}>Your stylist</h1>
        <p className="lede">Chat with an AI stylist about your actual wardrobe — event outfits, packing lists, what's missing. Connect a free AI (Google Gemini or OpenRouter's free models like Kimi) in settings — it takes a minute and costs nothing.</p>
        <a className="circle" href="#/settings" style={{ marginTop: 22, textDecoration: "none" }}>connect AI</a>
        <p className="muted small" style={{ marginTop: 18 }}>Everything else in Drape — outfit suggestions, planning, insights — works without it.</p>
      </div>
    );
  }

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    const next: Turn[] = [...turns, { role: "user", text: q.trim() }];
    setTurns(next); setText(""); setBusy(true); setErr(null);
    const now = new Date();
    const weather = wx && loc ? `Weather in ${loc.name}: now ${fmtTemp(wx.temp, settings.units)} ${describe(wx.code).label}; next days: ${wx.daily.slice(0, 7).map((d) => `${d.date} ${Math.round(d.min)}–${Math.round(d.max)}°C ${describe(d.code).label} ${d.rainChance}% rain`).join("; ")}.` : "Weather unknown.";
    const history = next.map((t, i) => ({
      role: t.role,
      content: i === next.length - 1 ? `${t.text}\n\n(Today is ${now.toDateString()}. ${weather})` : t.text + (t.outfits?.length ? `\n[Suggested outfits: ${t.outfits.map((o) => `${o.name}: ${o.itemIds.join(",")}`).join(" | ")}]` : ""),
    }));
    try {
      const pal = paletteText(settings);
      const r = await askStylist(history, wardrobeDigest(items, counts) + (pal ? `\n\nThe user's personal colours (a preference, not a filter: best colours near the face, the rest still worn):\n${pal}` : ""));
      const valid = r.outfits.map((o) => ({ ...o, itemIds: o.itemIds.filter((id) => items.some((i) => i.id === id)) })).filter((o) => o.itemIds.length);
      setTurns([...next, { role: "assistant", text: r.message, outfits: valid }]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setTurns(turns);
      setText(q);
    } finally { setBusy(false); }
  };

  return (
    <div className="page">
      <div className="chat">
        {turns.length === 0 && (
          <div className="center" style={{ padding: "30px 0 10px" }}>
            <h1 className="display" style={{ fontSize: "clamp(36px,7vw,72px)" }}>Ask your stylist</h1>
            <p className="lede">Your stylist knows every piece in your closet{wx ? " and this week's weather" : ""}.</p>
            <div className="stack" style={{ marginTop: 24, justifyItems: "center" }}>
              {PROMPTS.map((p) => <button key={p} className="link" style={{ fontSize: 17 }} onClick={() => send(p)}>{p}</button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={"msg " + (t.role === "user" ? "user" : "ai")}>
            <div style={{ whiteSpace: "pre-wrap" }}>{t.text}</div>
            {t.outfits && t.outfits.length > 0 && (
              <div className="looks" style={{ marginTop: 14 }}>
                {t.outfits.map((o) => (
                  <div className="look" key={o.name + o.itemIds.join()}>
                    <OutfitBoard items={o.itemIds.map((id) => items.find((x) => x.id === id)!).filter(Boolean)} />
                    <span className="hand" style={{ fontSize: 24 }}>{o.name}</span>
                    <p>{o.why}</p>
                    <button className="btn sm" onClick={async () => { await saveOutfit({ id: uid(), name: o.name, itemIds: o.itemIds, favorite: false, source: "ai", notes: o.why, createdAt: Date.now() }); toast("Saved to looks"); }}><Bookmark size={14} /> save</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="msg ai row"><Spinner /> <span className="hand">thinking it over…</span></div>}
        {err && <p className="notice err">{err}</p>}
        <div ref={endRef} />
        <div className="composer">
          <textarea rows={1} placeholder="Ask about an outfit, an event, a trip…" value={text} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(text); } }} />
          {turns.length > 0 && <button className="btn sm ghost" onClick={() => setTurns([])}>clear</button>}
          <button className="circle sm" style={{ width: 46, height: 46, padding: 0 }} disabled={busy || !text.trim()} onClick={() => send(text)} aria-label="Send"><ArrowUp size={20} /></button>
        </div>
      </div>
    </div>
  );
}
