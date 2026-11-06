import { registerNotificationChannel } from "@agent-native/core/notifications";

import { createExpoPushChannel } from "../lib/notifications/expo-push";

/** Registers the Expo push channel (companion app). No config needed: Expo's push service is keyed by the token itself. */
export default (): void => {
  registerNotificationChannel(createExpoPushChannel());
};
