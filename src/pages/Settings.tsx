import { Eye, EyeOff, LocateFixed } from "lucide-react";
import { useRef, useState } from "react";
import { Chips, Toggle } from "../components/ui";
import { CLAUDE_MODELS, listModels, pickFree, PROVIDERS, type ModelInfo } from "../lib/ai";
import type { Provider } from "../lib/types";
import { deleteItem, exportBackup, importBackup, saveSettings, wipeAll } from "../lib/db";
import { toast, useStore } from "../lib/hooks";
import { loadSampleWardrobe } from "../lib/sample";
import { locateMe, searchPlaces } from "../lib/weather";
import { appsScript, clearImportFolder, connect, disconnect, newToken, onSyncStatus, SCRIPT_VERSION, setImportFolder, syncLink, syncNow, syncStatus } from "../lib/drive";
import { useEffect, useSyncExternalStore } from "react";

export default function SettingsPage() {
  const { settings, items } = useStore();
  const [q, setQ] = useState("");
  const [places, setPlaces] = useState<{ name: string; lat: number; lon: number }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const samples = items.filter((i) => i.sample);

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="display" style={{ fontSize: "clamp(36px,7vw,72px)" }}>Settings</h1>

      <section className="section stack">
        <h2 className="h3">Location & weather</h2>
        <p className="muted small" style={{ margin: 0 }}>Used for weather-aware outfits (free forecast from Open-Meteo). {settings.location && <>Currently: <b>{settings.location.name}</b></>}</p>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" placeholder="Search your city" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={async (e) => { if (e.key === "Enter" && q.trim()) setPlaces(await searchPlaces(q).catch(() => [])); }} />
          <button className="btn sm" onClick={async () => setPlaces(await searchPlaces(q).catch(() => []))} disabled={!q.trim()}>search</button>
          <button className="btn sm ghost" onClick={async () => {
            try { const p = await locateMe(); await saveSettings({ location: { name: "My location", ...p } }); toast("Location set"); }
            catch { toast("Couldn't get your location — search for your city instead"); }
          }}><LocateFixed size={14} /> use mine</button>
        </div>
        {places.length > 0 && <div className="stack" style={{ gap: 4 }}>{places.map((p) => (
          <button key={p.name + p.lat} className="link" style={{ textAlign: "left" }} onClick={async () => { await saveSettings({ location: p }); setPlaces([]); setQ(""); toast(`Location set to ${p.name}`); }}>{p.name}</button>
        ))}</div>}
        <div className="grid2">
          <label className="field"><span>temperature</span><Chips options={["c", "f"] as const} value={settings.units} labels={{ c: "°C", f: "°F" }} onChange={(u) => saveSettings({ units: u })} /></label>
          <label className="field"><span>currency symbol</span><input className="input" value={settings.currency} maxLength={4} onChange={(e) => saveSettings({ currency: e.target.value })} /></label>
        </div>
      </section>

      <DriveSettings />

      <section className="section stack">
        <h2 className="h3">Photos</h2>
        <Toggle on={settings.autoRemoveBg} onChange={(v) => saveSettings({ autoRemoveBg: v })} label="Cut out backgrounds automatically" hint="Runs on your device — free and private. First use downloads a ~40 MB model." />
      </section>

      <AISettings />

      <section className="section stack">
        <h2 className="h3">Link helper (optional)</h2>
        <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>
          Shop links are read with a free public reader. If a shop blocks it, you can run your own free helper on Cloudflare (included in the project's <code>worker/</code> folder) and paste its address here.
        </p>
        <input className="input" placeholder="https://drape-link.yourname.workers.dev" value={settings.proxyUrl || ""} onChange={(e) => saveSettings({ proxyUrl: e.target.value.trim() || undefined })} />
      </section>

      <section className="section stack">
        <h2 className="h3">Appearance</h2>
        <Chips options={["light", "dark", "system"] as const} value={settings.theme} labels={{ light: "white", dark: "dark", system: "match my device" }} onChange={(t) => saveSettings({ theme: t })} />
      </section>

      <section className="section stack">
        <h2 className="h3">Your data</h2>
        <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>Your wardrobe is always kept in this browser too, so the app works offline. A backup file is a handy extra copy.</p>
        <div className="row">
          <button className="btn sm solid" onClick={async () => {
            const b = await exportBackup();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(b);
            a.download = `drape-backup-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
          }}>export backup</button>
          <button className="btn sm" onClick={() => fileRef.current?.click()}>import backup</button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { await importBackup(f); toast("Backup imported"); } catch (err) { toast(err instanceof Error ? err.message : "Import failed"); }
            e.target.value = "";
          }} />
          {samples.length > 0
            ? <button className="btn sm ghost" onClick={async () => { for (const s of samples) await deleteItem(s.id); toast("Sample pieces removed"); }}>remove sample pieces ({samples.length})</button>
            : <button className="btn sm ghost" onClick={async () => { await loadSampleWardrobe(); toast("Sample wardrobe added"); }}>add sample wardrobe</button>}
          <button className="btn sm danger" onClick={async () => { if (confirm("Delete your whole wardrobe, looks and history from this device? Export a backup first if unsure.")) { await wipeAll(); toast("Everything deleted"); } }}>delete everything</button>
        </div>
      </section>
      <p className="muted small section">Drape · open source · runs entirely in your browser.</p>
    </div>
  );
}

function AISettings() {
  const { settings } = useStore();
  const current: Provider = settings.provider || (settings.apiKey ? "claude" : "gemini");
  const [p, setP] = useState<Provider>(current);
  const [key, setKey] = useState((p === "claude" ? settings.apiKey : settings.keys?.[p]) || "");
  const [show, setShow] = useState(false);
  const [models, setModels] = useState<ModelInfo[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const info = PROVIDERS[p];
  const chosen = settings.models?.[p] || {};

  const choose = (np: Provider) => {
    setP(np); setModels(null); setMsg(null);
    setKey((np === "claude" ? settings.apiKey : settings.keys?.[np]) || "");
  };
  const setModel = (kind: "vision" | "text", id: string) =>
    saveSettings({ models: { ...settings.models, [p]: { ...settings.models?.[p], [kind]: id || undefined } } });

  const fetchModels = async (k = key) => {
    setBusy(true); setMsg(null);
    try {
      const list = await listModels(p, k.trim(), settings.customBase);
      if (p === "openrouter") {
        const pick = pickFree(list);
        setModels(pick.free);
        if (!pick.free.length) setMsg("No free models listed right now — check openrouter.ai/models.");
        else {
          const keepV = pick.free.some((m) => m.id === chosen.vision) ? chosen.vision : pick.vision;
          const keepT = pick.free.some((m) => m.id === chosen.text) ? chosen.text : pick.text;
          await saveSettings({ models: { ...settings.models, openrouter: { vision: keepV, text: keepT } } });
          setMsg(`${pick.free.length} free models found${pick.vision ? "" : " — none can read photos right now, so photo tagging is off until one is"}.`);
        }
      } else { setModels(list); setMsg(`${list.length} models available.`); }
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };

  const save = async () => {
    const k = key.trim() || undefined;
    if (p === "claude") await saveSettings({ provider: p, apiKey: k });
    else await saveSettings({ provider: p, keys: { ...settings.keys, [p]: k } });
    toast(k || p === "custom" ? `${info.label} connected` : "Key removed");
    if (p === "openrouter" && k) fetchModels(k);
  };

  const ModelSelect = ({ kind }: { kind: "vision" | "text" }) => {
    const opts = (models || []).filter((m) => kind === "text" || m.vision);
    const value = chosen[kind] || (kind === "vision" ? info.vision : info.text) || "";
    return (
      <label className="field"><span>{kind === "vision" ? "model for photos (must read images)" : "model for the stylist chat"}</span>
        {opts.length ? (
          <select className="select" value={value} onChange={(e) => setModel(kind, e.target.value)}>
            {!opts.some((m) => m.id === value) && value && <option value={value}>{value}</option>}
            {opts.map((m) => <option key={m.id} value={m.id}>{m.name}{m.vision && kind === "text" ? " · sees photos" : ""}</option>)}
          </select>
        ) : (
          <input className="input" value={value} placeholder={kind === "vision" ? "e.g. gemma3" : "e.g. kimi-k2"} onChange={(e) => setModel(kind, e.target.value.trim())} />
        )}
      </label>
    );
  };

  return (
    <section className="section stack">
      <h2 className="h3">AI (optional)</h2>
      <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>
        AI tags your photos, reads shop links and powers the stylist chat. Outfit suggestions, planning and insights work without it.
        Your key stays in this browser and is only sent to the provider you pick.
      </p>
      <div className="stack" style={{ gap: 0 }}>
        {(Object.keys(PROVIDERS) as Provider[]).map((id) => (
          <label key={id} className="toggle" onClick={(e) => { e.preventDefault(); choose(id); }}>
            <span>{PROVIDERS[id].label} <span className="hand" style={{ fontSize: 19 }}>{PROVIDERS[id].cost.toLowerCase()}</span>
              {current === id && hasKey(settings, id) && <span className="muted small"> · in use</span>}</span>
            <span className={"switch" + (p === id ? " on" : "")} role="radio" aria-checked={p === id} />
          </label>
        ))}
      </div>
      <p className="notice small" style={{ margin: 0 }}>{info.note}</p>
      {p === "custom" && (
        <label className="field"><span>server address</span>
          <input className="input" placeholder="http://localhost:11434/v1" value={settings.customBase || ""} onChange={(e) => saveSettings({ customBase: e.target.value.trim() || undefined })} />
        </label>
      )}
      <label className="field"><span>API key {info.keyUrl && <>— <a href={info.keyUrl} target="_blank" rel="noreferrer">get a free key</a></>}{p === "claude" && " (paid)"}{p === "custom" && " (if your server needs one)"}</span>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input className="input" type={show ? "text" : "password"} placeholder={p === "claude" ? "sk-ant-…" : p === "openrouter" ? "sk-or-…" : p === "gemini" ? "paste your Gemini key" : "optional"} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" spellCheck={false} />
          <button className="iconbtn" onClick={() => setShow(!show)} aria-label={show ? "Hide key" : "Show key"}>{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          <button className="btn sm solid" onClick={save}>{current === p ? "save" : "use this"}</button>
        </div>
      </label>
      {p === "claude" ? (
        <label className="field"><span>model</span>
          <select className="select" value={settings.model} onChange={(e) => saveSettings({ model: e.target.value })}>
            {CLAUDE_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} — {m.note}</option>)}
          </select>
        </label>
      ) : (
        <>
          <div className="row">
            <button className="btn sm" disabled={busy || (p !== "openrouter" && p !== "custom" && !key.trim())} onClick={() => fetchModels()}>{busy ? "checking…" : p === "openrouter" ? "find free models" : "list models"}</button>
            {msg && <span className="small muted">{msg}</span>}
          </div>
          <div className="grid2"><ModelSelect kind="vision" /><ModelSelect kind="text" /></div>
        </>
      )}
      <Toggle on={settings.autoTag} onChange={(v) => saveSettings({ autoTag: v })} label="Tag new photos with AI" hint="Fills in name, type, colours, season, formality and warmth. Uses one request per photo." />
    </section>
  );
}

function hasKey(s: ReturnType<typeof useStore>["settings"], p: Provider) {
  return p === "claude" ? !!s.apiKey : p === "custom" ? !!s.customBase : !!s.keys?.[p];
}

function DriveSettings() {
  const { settings } = useStore();
  const st = useSyncExternalStore(onSyncStatus, syncStatus, syncStatus);
  const [link, setLink] = useState("");
  const [folderLink, setFolderLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const token = settings.syncToken;
  // Make this device's private key the first time the section is shown.
  useEffect(() => { if (!settings.syncToken) saveSettings({ syncToken: newToken() }); }, [settings.syncToken]);

  const copy = async (text: string, what: string, el?: HTMLTextAreaElement | null) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); }
    catch { el?.select(); setCopied(null); toast("Select all and copy it manually"); }
    setTimeout(() => setCopied(null), 2500);
  };
  const go = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    setBusy(false);
  };
  const last = settings.lastSync ? new Date(settings.lastSync).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : null;
  const script = token ? appsScript(token) : "";
  let scriptBox: HTMLTextAreaElement | null = null;
  let linkBox: HTMLTextAreaElement | null = null;

  return (
    <section className="section stack">
      <h2 className="h3">Google Drive sync</h2>
      <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>
        Saves your pieces, photos, looks and calendar to a <b>Drape wardrobe</b> folder in your own Google Drive (free, 15 GB),
        and keeps your phone and laptop in step. It works through a small script in your Google account, so there's nothing else to sign up for.
      </p>
      {settings.driveConnected && settings.syncUrl ? (
        <>
          <p className="notice small" style={{ margin: 0 }}>
            Connected{last ? <> · last synced {last}</> : null}
            {st.state === "syncing" && <> · syncing{st.msg ? ` (${st.msg.toLowerCase()})` : "…"}</>}
            {st.state === "error" && <><br /><span style={{ color: "var(--danger)" }}>{st.msg}</span></>}
            {settings.syncFolderUrl && <><br /><a href={settings.syncFolderUrl} target="_blank" rel="noreferrer">open the folder in Drive ↗</a></>}
          </p>
          <div className="row">
            <button className="btn sm solid" disabled={busy || st.state === "syncing"} onClick={() => go(() => syncNow())}>sync now</button>
            <button className="btn sm ghost" disabled={busy} onClick={() => go(() => disconnect())}>disconnect this device</button>
          </div>
          {(settings.syncScriptVersion || 1) < SCRIPT_VERSION ? (
            <div className="notice small" style={{ margin: 0 }}>
              <b>Update your Drive script</b> to let Drape pick up clothing photos you add to Drive (takes a minute, your link stays the same):
              <ol style={{ margin: "8px 0 0", paddingLeft: 20, display: "grid", gap: 6 }}>
                <li><button className="btn sm solid" onClick={() => copy(script, "script", scriptBox)}>{copied === "script" ? "copied ✓" : "copy my script"}</button>
                  <textarea ref={(el) => { scriptBox = el; }} readOnly value={script} className="visually-hidden" aria-hidden tabIndex={-1} /></li>
                <li>Open your project on <a href="https://script.google.com/home" target="_blank" rel="noreferrer">script.google.com</a>, replace all the code with the copy, and press <b>Save</b>.</li>
                <li><b>Deploy → Manage deployments</b> → the pencil ✏️ → <b>Version: New version</b> → <b>Deploy</b>. If Google asks for permission again, allow it.</li>
                <li>Come back and tap <b>sync now</b>.</li>
              </ol>
            </div>
          ) : (
            <div className="stack" style={{ gap: 8 }}>
              <h3 className="small" style={{ margin: "6px 0 0", fontWeight: 600 }}>Add clothes straight from Drive</h3>
              <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>
                Drop clothing photos into your {settings.syncFolderUrl ? <a href={settings.syncFolderUrl} target="_blank" rel="noreferrer">Drape wardrobe folder</a> : "Drape wardrobe folder"}
                {settings.importFolderName ? <> or <b>{settings.importFolderName}</b></> : null} — each sync turns new photos into pieces (cut out and tagged, like an upload). Your photos in Drive are left as they are.
              </p>
              {settings.lastImport && <p className="muted small" style={{ margin: 0 }}>Last import: {settings.lastImport.added} added{settings.lastImport.failed ? `, ${settings.lastImport.failed} couldn't be read` : ""} · {new Date(settings.lastImport.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</p>}
              {settings.importFolderId ? (
                <div className="row"><span className="small">Also watching: <b>{settings.importFolderName}</b></span><button className="link small" onClick={() => clearImportFolder()}>stop</button></div>
              ) : (
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <input className="input small" placeholder="Another folder? Paste its Drive link" value={folderLink} onChange={(e) => setFolderLink(e.target.value)} spellCheck={false} />
                  <button className="btn sm" disabled={busy || !folderLink.trim()} onClick={() => go(async () => { const n = await setImportFolder(folderLink); setFolderLink(""); toast(`Found ${n} photo${n === 1 ? "" : "s"} — adding them now`); })}>use folder</button>
                </div>
              )}
            </div>
          )}
          <label className="field"><span>sync link for your other devices — paste it there under Settings › Google Drive sync. Keep it private: anyone with it can see your wardrobe.</span>
            <textarea ref={(el) => { linkBox = el; }} className="textarea small" readOnly rows={2} value={syncLink()} style={{ fontFamily: "monospace", fontSize: 12 }} />
          </label>
          <div><button className="btn sm" onClick={() => copy(syncLink(), "link", linkBox)}>{copied === "link" ? "copied ✓" : "copy sync link"}</button></div>
        </>
      ) : (
        <>
          <ol className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--ink-2)", display: "grid", gap: 10 }}>
            <li>
              <button className="btn sm solid" disabled={!token} onClick={() => copy(script, "script", scriptBox)}>{copied === "script" ? "copied ✓" : "copy my script"}</button>
              <textarea ref={(el) => { scriptBox = el; }} readOnly value={script} className="visually-hidden" aria-hidden tabIndex={-1} />
            </li>
            <li>Open <a href="https://script.google.com/home/projects/create" target="_blank" rel="noreferrer">script.google.com → New project</a>, delete what's there, paste, and press <b>Save</b> (💾).</li>
            <li>Click <b>Deploy → New deployment</b>, pick type <b>Web app</b>, set <b>Execute as: Me</b> and <b>Who has access: Anyone</b>, then <b>Deploy</b>.</li>
            <li>Google asks you to authorise it: choose your account → <b>Advanced</b> → <b>Go to Untitled project (unsafe)</b> → <b>Allow</b>. (It says “unsafe” only because it's your own unpublished script.)</li>
            <li>Copy the <b>Web app URL</b> and paste it here:</li>
          </ol>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input className="input" placeholder="https://script.google.com/macros/s/…/exec" value={link} spellCheck={false} onChange={(e) => setLink(e.target.value)} />
            <button className="btn sm solid" disabled={busy || !link.trim()} onClick={() => go(async () => { await connect(link, token); toast("Google Drive connected"); setLink(""); })}>{busy ? "connecting…" : "connect"}</button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>Already set up on another device? Paste the <b>sync link</b> from that device's settings into the same box.</p>
        </>
      )}
      {err && <p className="notice err small" style={{ margin: 0 }}>{err}</p>}
    </section>
  );
}
