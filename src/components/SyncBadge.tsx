import { CloudOff, RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { onSyncStatus, syncStatus, tapSync } from "../lib/drive";

/** Small Google Drive status in the header: synced / syncing / sync failed. */
export function SyncBadge() {
  const s = useSyncExternalStore(onSyncStatus, syncStatus, syncStatus);
  if (s.state === "off") return null;
  if (s.state === "syncing") return <span className="sync-badge" title={s.msg}><RefreshCw size={14} className="spin" /> <span className="hand">syncing</span></span>;
  if (s.state === "idle") return <button className="sync-badge" onClick={() => tapSync()} title="Saved to Google Drive — tap to sync now"><span className="hand">synced</span></button>;
  return (
    <button className="sync-badge err" onClick={() => tapSync()} title={s.msg}>
      <CloudOff size={14} /> <span className="hand">sync failed</span>
    </button>
  );
}
