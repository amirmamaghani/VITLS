import { callAction } from "@agent-native/core/client/hooks";
import { useSession } from "@agent-native/core/client/use-session";
import { useEffect } from "react";

import { isShell } from "../../shared/shell";
import { pairCodeFrom, postToShell, trackShellStatus } from "@/lib/shell-bridge";

const PAIRED_FLAG = "vitls-shell-paired";

/**
 * In the companion WebView: hand the phone a pairing code once the user is signed in (spec §3 step 4; the phone asks
 * the user to confirm the account before redeeming it) and keep the latest sync-status for the settings card. Renders nothing.
 */
export function ShellBridge() {
  const { session } = useSession();
  const userId = session?.email ?? null;
  useEffect(() => (isShell() ? trackShellStatus() : undefined), []);
  useEffect(() => {
    if (!userId || !isShell()) return;
    let paired = false;
    try {
      paired = sessionStorage.getItem(PAIRED_FLAG) === "1";
    } catch {}
    if (paired) return;
    void (async () => {
      try {
        const code = pairCodeFrom(await callAction("create-device-pairing", {}));
        if (!code) return;
        postToShell({ v: 1, type: "pair", code, email: userId });
        try {
          sessionStorage.setItem(PAIRED_FLAG, "1");
        } catch {}
      } catch (e) {
        console.warn("[shell] pairing failed", (e as Error)?.name);
      }
    })();
  }, [userId]);
  return null;
}
