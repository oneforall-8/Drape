import { Camera, Link2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Chips, ItemImg, Spinner } from "../components/ui";
import { hasAI } from "../lib/ai";
import { saveItem } from "../lib/db";
import { useStore } from "../lib/hooks";
import { ingestLink, ingestPhoto } from "../lib/pipeline";
import { CATEGORIES, CATEGORY_LABEL, type Category, type ItemStatus } from "../lib/types";

interface Job {
  key: string;
  kind: "photo" | "link";
  file?: File;
  url?: string;
  preview?: string;
  status: "waiting" | "working" | "done" | "error";
  msg?: string;
  itemId?: string;
}

export default function AddPage({ params }: { params: URLSearchParams }) {
  const { items, settings } = useStore();
  const ai = hasAI();
  const [to, setTo] = useState<ItemStatus>(params.get("to") === "wishlist" ? "wishlist" : "owned");
  const [cat, setCat] = useState<Category | "auto">(ai && settings.autoTag ? "auto" : "top");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [link, setLink] = useState("");
  const [over, setOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const running = useRef(false);
  const optsRef = useRef({ to, cat });
  optsRef.current = { to, cat };

  const addFiles = (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    setJobs((j) => [...j, ...list.map((f) => ({ key: Math.random().toString(36), kind: "photo" as const, file: f, preview: URL.createObjectURL(f), status: "waiting" as const }))]);
  };
  const addLink = () => {
    const urls = link.split(/\s+/).filter((u) => /^https?:\/\//.test(u));
    if (!urls.length) return;
    setJobs((j) => [...j, ...urls.map((u) => ({ key: Math.random().toString(36), kind: "link" as const, url: u, status: "waiting" as const }))]);
    setLink("");
  };

  // Paste images straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files || [])];
      if (files.length) { e.preventDefault(); addFiles(files); }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Process the queue one at a time (cut-outs are heavy).
  useEffect(() => {
    if (running.current) return;
    const next = jobs.find((j) => j.status === "waiting");
    if (!next) return;
    running.current = true;
    const update = (p: Partial<Job>) => setJobs((js) => js.map((j) => (j.key === next.key ? { ...j, ...p } : j)));
    update({ status: "working", msg: "Starting…" });
    const { to: status, cat: c } = optsRef.current;
    const category = c === "auto" ? undefined : c;
    const p = next.kind === "photo"
      ? ingestPhoto(next.file!, { category, status }, (m) => update({ msg: m }))
      : ingestLink(next.url!, { category, status }, (m) => update({ msg: m }));
    p.then((it) => update({ status: "done", itemId: it.id, msg: undefined }))
      .catch((e) => update({ status: "error", msg: e instanceof Error ? e.message : String(e) }))
      .finally(() => { running.current = false; setJobs((js) => [...js]); });
  }, [jobs]);

  const working = jobs.some((j) => j.status === "working" || j.status === "waiting");

  return (
    <div className="page">
      <h1 className="display" style={{ fontSize: "clamp(36px,7vw,72px)" }}>Add pieces</h1>
      <p className="lede" style={{ marginLeft: 0 }}>Photos of clothes you own (on a bed, a hanger or the floor all work), screenshots, or links to shop pages.</p>

      <div className="tabs" style={{ marginTop: 20 }}>
        <button className={to === "owned" ? "on" : ""} onClick={() => setTo("owned")}>to my closet</button>
        <button className={to === "wishlist" ? "on" : ""} onClick={() => setTo("wishlist")}>to my wishlist</button>
      </div>

      <div className="field" style={{ marginTop: 18 }}>
        <span>what are you adding?</span>
        <Chips
          options={[...(ai ? (["auto"] as const) : []), ...CATEGORIES] as (Category | "auto")[]}
          value={cat}
          onChange={setCat}
          labels={{ auto: "✦ let AI decide", ...Object.fromEntries(CATEGORIES.map((c) => [c, CATEGORY_LABEL[c].toLowerCase()])) }}
        />
      </div>

      <div className="split" style={{ marginTop: 24, gridTemplateColumns: undefined }}>
        <div
          className={"drop" + (over ? " over" : "")}
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); addFiles(e.dataTransfer.files); }}
        >
          <Upload size={26} strokeWidth={1.2} />
          <div className="h3">Drop photos here</div>
          <div className="muted small">or click to choose — add as many as you like · you can also paste</div>
          <div className="row" style={{ justifyContent: "center" }} onClick={(e) => e.stopPropagation()}>
            <button className="btn sm solid" onClick={() => fileRef.current?.click()}>choose photos</button>
            <button className="btn sm" onClick={() => camRef.current?.click()}><Camera size={14} /> camera</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { e.target.files && addFiles(e.target.files); e.target.value = ""; }} />
          <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { e.target.files && addFiles(e.target.files); e.target.value = ""; }} />
        </div>
        <div className="stack">
          <div className="field">
            <span>paste a product link</span>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <Link2 size={18} className="muted" />
              <input className="input" placeholder="https://shop.com/product/…" value={link} onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addLink()} />
              <button className="btn sm solid" onClick={addLink} disabled={!link.trim()}>import</button>
            </div>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            {ai
              ? "The page is read for you: name, details and the product photo are filled in."
              : <>Drape grabs the product name, price and photo for free. Turn on AI in <a href="#/settings">settings</a> (free options available) to fill in the rest automatically.</>}
          </p>
          <div className="notice small">
            {settings.autoRemoveBg ? "Backgrounds are cut out on your device (the first time downloads a ~40 MB model)." : "Background removal is off — turn it on in settings for the cut-out look."}
            {ai ? (settings.autoTag ? " AI tags each photo: type, colours, season, formality." : "") : " Without AI you pick the category; colours are detected automatically and you can fine-tune the rest."}
          </div>
        </div>
      </div>

      {jobs.length > 0 && (
        <section className="section">
          <div className="spread" style={{ marginBottom: 14 }}>
            <h2 className="h3">{working ? <span className="row"><Spinner /> working through {jobs.filter((j) => j.status !== "done" && j.status !== "error").length}…</span> : "All done"}</h2>
            {!working && <a className="btn sm" href={to === "wishlist" ? "#/closet" : "#/closet"}>go to closet</a>}
          </div>
          <div className="queue">
            {jobs.map((j) => <JobCard key={j.key} job={j} item={items.find((i) => i.id === j.itemId)} />)}
          </div>
        </section>
      )}
    </div>
  );
}

function JobCard({ job, item }: { job: Job; item?: ReturnType<typeof useStore>["items"][number] }) {
  return (
    <div className="qcard">
      <div className="img-wrap">
        {item ? <ItemImg item={item} /> : job.preview ? <img src={job.preview} alt="" style={{ opacity: 0.5 }} /> : <span className="hand">link</span>}
      </div>
      {item ? (
        <>
          <input className="input small" value={item.name} onChange={(e) => saveItem({ ...item, name: e.target.value })} />
          <select className="select small" value={item.category} onChange={(e) => saveItem({ ...item, category: e.target.value as Category })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c].toLowerCase()}</option>)}
          </select>
          <a className="small" href={`#/item/${item.id}`}>edit details</a>
        </>
      ) : (
        <div className={"small" + (job.status === "error" ? "" : " muted")} style={{ color: job.status === "error" ? "var(--danger)" : undefined }}>
          {job.status === "working" && <Spinner />} {job.msg || (job.status === "waiting" ? "waiting…" : "")}
          {job.url && <div className="muted" style={{ wordBreak: "break-all" }}>{job.url}</div>}
        </div>
      )}
    </div>
  );
}
