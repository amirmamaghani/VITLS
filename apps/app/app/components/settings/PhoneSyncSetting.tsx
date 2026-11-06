import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { latestStatus, postToShell, subscribeStatus, type BridgeIn } from "@/lib/shell-bridge";
import { isShell } from "../../../shared/shell";

/** Settings → This phone (shell only): sync status from the companion and a Sync now button over the bridge (spec §5). */
export function PhoneSyncSetting() {
  const [status, setStatus] = useState<BridgeIn | undefined>(latestStatus);
  useEffect(() => subscribeStatus(setStatus), []);
  if (!isShell()) return null;
  return (
    <div className="space-y-2">
      <p className="text-sm">Device: {status?.deviceId ?? "pairing…"}</p>
      <p className="text-sm">Last sync: {status?.lastSyncAt ?? "never"}</p>
      {status?.lastError ? <p className="text-sm text-destructive">{status.lastError}</p> : null}
      {/* Always enabled: the phone answers sync-now with a sync-status even when it is not paired yet. */}
      <Button onClick={() => postToShell({ v: 1, type: "sync-now" })}>
        Sync now
      </Button>
    </div>
  );
}
