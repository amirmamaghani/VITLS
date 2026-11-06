import { callAction } from "@agent-native/core/client/hooks";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

type State = "loading" | "unsupported" | "disabled-on-server" | "denied" | "off" | "on";

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function toUint8(base64: string) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** Settings → Notifications: turn the morning readout push on/off for this device. */
export function PushNotificationsSetting() {
  const [state, setState] = useState<State>("loading");
  const [publicKey, setPublicKey] = useState<string | null>(null);

  useEffect(() => {
    if (!supported()) return setState("unsupported");
    void (async () => {
      const config = (await callAction("manage-push-subscription", { action: "config" })) as { enabled: boolean; publicKey: string | null };
      if (!config.enabled) return setState("disabled-on-server");
      setPublicKey(config.publicKey);
      if (Notification.permission === "denied") return setState("denied");
      const registration = await navigator.serviceWorker.getRegistration("/");
      setState((await registration?.pushManager.getSubscription()) ? "on" : "off");
    })();
  }, []);

  async function enable() {
    const registration = await navigator.serviceWorker.register("/sw.js");
    if ((await Notification.requestPermission()) !== "granted") return setState("denied");
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toUint8(publicKey!) });
    const json = subscription.toJSON();
    await callAction("manage-push-subscription", {
      action: "subscribe",
      subscription: { endpoint: json.endpoint!, keys: { p256dh: json.keys!.p256dh!, auth: json.keys!.auth! } },
      label: navigator.userAgent.slice(0, 100),
    });
    setState("on");
  }

  async function disable() {
    const subscription = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    if (subscription) {
      await callAction("manage-push-subscription", { action: "unsubscribe", endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setState("off");
  }

  const hint: Record<State, string> = {
    loading: "Checking this device…",
    unsupported: "This browser does not support push notifications. On iPhone, add VITLS to the Home Screen first.",
    "disabled-on-server": "Push notifications are not configured on this server.",
    denied: "Notifications are blocked for this site in your browser settings.",
    off: "Get your morning readout as a notification on this device.",
    on: "Morning readouts are delivered to this device.",
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <p className="text-sm font-medium">Push notifications</p>
        <p className="text-sm text-muted-foreground">{hint[state]}</p>
      </div>
      {state === "off" && <Button onClick={() => void enable()}>Enable</Button>}
      {state === "on" && (
        <Button variant="outline" onClick={() => void disable()}>
          Disable
        </Button>
      )}
    </div>
  );
}
