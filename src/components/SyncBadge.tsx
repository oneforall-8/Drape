import { CloudOff, RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { onSyncStatus, syncStatus, tapSync } from "../lib/drive";
import { toast } from "../lib/hooks";

/** Small Google Drive status in the header: synced / syncing / tap to sync. */
export function SyncBadge() {
  const s = useSyncExternalStore(onSyncStatus, syncStatus, syncStatus);
  if (s.state === "off") return null;
  const tap = () => tapSync().catch((e) => toast(e instanceof Error ? e.message : String(e)));
  if (s.state === "syncing") return <span className="sync-badge" title={s.msg}><RefreshCw size={14} className="spin" /> <span className="hand">syncing</span></span>;
  if (s.state === "idle") return <button className="sync-badge" onClick={tap} title="Saved to Google Drive — tap to sync now"><span className="hand">synced</span></button>;
  return (
    <button className={"sync-badge " + (s.state === "error" ? "err" : "warn")} onClick={tap} title={s.msg}>
      <CloudOff size={14} /> <span className="hand">{s.state === "error" ? "sync failed" : "tap to sync"}</span>
    </button>
  );
}
