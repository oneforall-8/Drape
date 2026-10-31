import type { ReactNode } from "react";
import { hashNum, useItemImage } from "../lib/hooks";
import type { Item } from "../lib/types";

export interface HeroPiece { key: string; label: string; item?: Item; src?: string; href?: string }

/**
 * Pieces arranged around a headline, like a styled flat-lay.
 * It's a grid, so pieces and text can never overlap at any screen size:
 * phones show 6 pieces (3 above, 3 below), wider screens show up to 12 around the text.
 */
export function Hero({ pieces, children }: { pieces: HeroPiece[]; children: ReactNode }) {
  return (
    <section className="hero">
      {pieces.slice(0, 12).map((p, i) => <Slot key={p.key} p={p} i={i} />)}
      <div className="hero-text">{children}</div>
    </section>
  );
}

function Slot({ p, i }: { p: HeroPiece; i: number }) {
  const url = useItemImage(p.item);
  const src = p.src || url;
  const h = hashNum(p.key);
  const rot = (h - 0.5) * 10;
  const dx = (hashNum(p.key + "x") - 0.5) * 12;
  const left = hashNum(p.key + "l") > 0.5;
  const Tag = p.href ? "a" : "div";
  return (
    <Tag className={`hero-slot p${i + 1}`} href={p.href} style={{ textDecoration: "none" }}>
      <div className="hero-img" style={{ transform: `translateX(${dx}px) rotate(${rot}deg)` }}>{src && <img src={src} alt={p.label} draggable={false} />}</div>
      <span className="hand" style={{ alignSelf: left ? "flex-start" : "flex-end", transform: `rotate(${(h - 0.5) * 6}deg)` }}>{p.label}</span>
    </Tag>
  );
}
