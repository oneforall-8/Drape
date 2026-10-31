import { Check, Heart, Lock, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { hashNum, useItemImage } from "../lib/hooks";
import { roleOf } from "../lib/rules";
import type { Item, LayoutSlot } from "../lib/types";

export function ItemImg({ item, className, alt }: { item?: Item; className?: string; alt?: string }) {
  const url = useItemImage(item);
  if (!item) return null;
  if (!url) return <div className="ph">{(item.subcategory || item.category).toLowerCase()}</div>;
  return <img className={className} src={url} alt={alt ?? item.name} loading="lazy" draggable={false} />;
}

export const label = (it: Item) => (it.subcategory || it.category).toLowerCase();

/** A cut-out piece floating on the page with a handwritten catalogue label. */
export function Piece({ item, num, onClick, dim, href }: { item: Item; num?: string; onClick?: () => void; dim?: boolean; href?: string }) {
  const h = hashNum(item.id);
  const rot = (h - 0.5) * 6;
  const dy = (hashNum(item.id + "y") - 0.5) * 10;
  const sc = 0.82 + hashNum(item.id + "s") * 0.16;
  const side = h > 0.5;
  const Tag = href ? "a" : "div";
  return (
    <Tag className={"piece" + (dim ? " dim" : "")} href={href} onClick={onClick} role={onClick ? "button" : undefined}>
      <div className="img-wrap" style={{ transform: `translateY(${dy}px) rotate(${rot}deg) scale(${sc})` }}>
        <ItemImg item={item} />
      </div>
      <span className="hand" style={{ alignSelf: side ? "flex-end" : "flex-start", transform: `rotate(${(hashNum(item.id + "l") - 0.5) * 6}deg)` }}>
        {num ? `${num} ` : ""}{label(item)}
      </span>
      {item.favorite && <Heart className="heart" size={15} fill="currentColor" />}
    </Tag>
  );
}

// ---------- Outfit flat-lay ----------
export function autoLayout(items: Item[]): LayoutSlot[] {
  const by = (r: string) => items.filter((i) => roleOf(i) === r);
  const slots: LayoutSlot[] = [];
  const outer = by("outer"), mid = by("mid"), top = by("top"), dress = by("dress"), bottom = by("bottom");
  const shoes = by("shoes"), bag = by("bag"), acc = by("accessory");
  const upper = [...outer, ...mid, ...top, ...dress];
  const n = upper.length;
  // Upper pieces fan out left→right, overlapping like a flat-lay.
  const xs = n <= 1 ? [0.5] : n === 2 ? [0.33, 0.66] : n === 3 ? [0.26, 0.52, 0.76] : upper.map((_, i) => 0.2 + (0.6 * i) / (n - 1));
  upper.forEach((it, i) => {
    const isDress = roleOf(it) === "dress";
    const big = roleOf(it) === "outer";
    slots.push({
      itemId: it.id,
      x: xs[i],
      y: isDress ? 0.4 : big ? 0.34 : 0.3 + (i % 2) * 0.05,
      w: n >= 3 ? (big ? 0.46 : 0.4) : isDress ? 0.48 : big ? 0.54 : 0.5,
      r: (hashNum(it.id) - 0.5) * 8,
      z: big ? 1 : 2 + i,
    });
  });
  bottom.forEach((it, i) => slots.push({ itemId: it.id, x: 0.5 + i * 0.1, y: n ? 0.68 : 0.45, w: 0.4, r: (hashNum(it.id) - 0.5) * 5, z: 1.5 }));
  shoes.forEach((it, i) => slots.push({ itemId: it.id, x: 0.8 - i * 0.12, y: 0.86, w: 0.3, r: -8 + i * 10, z: 6 }));
  bag.forEach((it, i) => slots.push({ itemId: it.id, x: 0.2 + i * 0.1, y: 0.82, w: 0.3, r: 4, z: 5 }));
  acc.forEach((it, i) => slots.push({ itemId: it.id, x: i % 2 ? 0.16 : 0.85, y: 0.12 + Math.floor(i / 2) * 0.16, w: 0.22, r: (hashNum(it.id) - 0.5) * 16, z: 7 }));
  return slots;
}

export function OutfitBoard({
  items, layout, edit, onChange, locked, onToggleLock, labels, nums, selected, onSelect, className,
}: {
  items: Item[];
  layout?: LayoutSlot[];
  edit?: boolean;
  onChange?: (l: LayoutSlot[]) => void;
  locked?: string[];
  onToggleLock?: (id: string) => void;
  labels?: boolean;
  nums?: Record<string, string>;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const slots = (layout && layout.length ? layout.filter((s) => items.some((i) => i.id === s.itemId)) : autoLayout(items));
  // include items missing from a saved layout
  const missing = items.filter((i) => !slots.some((s) => s.itemId === i.id));
  const all = missing.length ? [...slots, ...autoLayout(missing)] : slots;
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  const onDown = (e: React.PointerEvent, s: LayoutSlot) => {
    if (onToggleLock) { onToggleLock(s.itemId); return; }
    if (!edit || !ref.current) return;
    e.preventDefault();
    const r = ref.current.getBoundingClientRect();
    drag.current = { id: s.itemId, dx: (e.clientX - r.left) / r.width - s.x, dy: (e.clientY - r.top) / r.height - s.y };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    onSelect?.(s.itemId);
    // bring to front
    const maxZ = Math.max(...all.map((x) => x.z));
    if (s.z < maxZ) onChange?.(all.map((x) => (x.itemId === s.itemId ? { ...x, z: maxZ + 1 } : x)));
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const d = drag.current;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width - d.dx));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height - d.dy));
    onChange?.(all.map((s) => (s.itemId === d.id ? { ...s, x, y } : s)));
  };
  const onUp = () => { drag.current = null; };

  return (
    <div
      ref={ref}
      className={"board" + (edit ? " edit" : "") + (onToggleLock ? " lockable" : "") + (className ? " " + className : "")}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerDown={(e) => { if (e.target === ref.current) onSelect?.(null); }}
    >
      {all.map((s) => {
        const it = items.find((i) => i.id === s.itemId);
        if (!it) return null;
        return (
          <div
            key={s.itemId}
            className={"slot" + (selected === s.itemId ? " sel" : "")}
            style={{ left: `${s.x * 100}%`, top: `${s.y * 100}%`, width: `${s.w * 100}%`, zIndex: Math.round(s.z * 10), transform: `translate(-50%, -50%) rotate(${s.r}deg)` }}
            onPointerDown={(e) => onDown(e, s)}
            title={it.name}
          >
            <ItemImg item={it} />
            {labels && (
              <span className="hand" style={{ position: "absolute", right: -6, bottom: -6, fontSize: 17, transform: `rotate(${-s.r}deg)` }}>
                {nums?.[it.id] ? `${parseInt(nums[it.id])} ` : ""}{label(it)}
              </span>
            )}
            {locked?.includes(s.itemId) && <span className="lock"><Lock size={12} /></span>}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Small building blocks ----------
export function Modal({ children, onClose, wide }: { children: ReactNode; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, [onClose]);
  return (
    <div className="overlay" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-modal="true">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: -8 }}>
          <button className="iconbtn" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toggle({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="toggle" onClick={(e) => { e.preventDefault(); onChange(!on); }}>
      <span>{label}{hint && <><br /><span className="muted small">{hint}</span></>}</span>
      <span className={"switch" + (on ? " on" : "")} role="switch" aria-checked={on} />
    </label>
  );
}

export function Chips<T extends string>({ options, value, onChange, labels, multi }: {
  options: readonly T[]; value: T[] | T; onChange: (v: any) => void; labels?: Partial<Record<T, string>>; multi?: boolean;
}) {
  const sel = Array.isArray(value) ? value : [value];
  return (
    <div className="chips">
      {options.map((o) => (
        <button type="button" key={o} className={"chip" + (sel.includes(o) ? " on" : "")}
          onClick={() => multi ? onChange(sel.includes(o) ? sel.filter((x) => x !== o) : [...sel, o]) : onChange(o)}>
          {labels?.[o] ?? o}
        </button>
      ))}
    </div>
  );
}

export function CheckRow({ on, label, onClick }: { on: boolean; label: ReactNode; onClick: () => void }) {
  return (
    <div className="check" onClick={onClick} role="checkbox" aria-checked={on}>
      <span className="box">{on && <Check size={13} />}</span>
      <span>{label}</span>
    </div>
  );
}

export function Dropdown({ trigger, children }: { trigger: (open: boolean) => ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, [open]);
  return (
    <div className="dropdown" ref={ref}>
      <button className="link" style={{ textDecoration: open ? "underline" : "none", fontSize: 17 }} onClick={() => setOpen(!open)}>{trigger(open)}</button>
      {open && <div className="dropdown-panel">{children}</div>}
    </div>
  );
}

export function Scale({ value, onChange, left, right }: { value: number; onChange: (n: number) => void; left: string; right: string }) {
  return (
    <div>
      <input className="range" type="range" min={1} max={5} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <div className="spread small muted"><span>{left}</span><span>{right}</span></div>
    </div>
  );
}

export function Spinner() { return <span className="spinner" aria-label="Loading" />; }

export function Dots({ colors }: { colors: string[] }) {
  return <span className="dots">{colors.map((c) => <i key={c} style={{ background: c }} />)}</span>;
}
