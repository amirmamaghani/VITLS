/** Expo push: register the token with the device token (spec §6); route notification taps into the native Chat tab. */
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect } from "react";

import { registerPush } from "./api";
import { saveState, type State } from "./sync";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

export async function ensurePushToken(state: State): Promise<State> {
  if (state.expoToken || !Device.isDevice) return state;
  // SDK 57 needs an EAS projectId for push tokens; without one, push stays inactive.
  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  if (!projectId) return state;
  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== "granted") return state;
  const { data: expoToken } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPush(state, expoToken, Device.modelName ?? undefined);
  const next = { ...state, expoToken };
  await saveState(next);
  return next;
}

export function usePushRouting(): void {
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse) => {
      void r; // the push url is a WebView concept; the native chat takes no url
      router.push("/chat");
    };
    void Notifications.getLastNotificationResponseAsync().then((r) => r && open(r));
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
}
