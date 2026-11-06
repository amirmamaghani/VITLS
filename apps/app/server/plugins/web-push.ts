import { registerNotificationChannel } from "@agent-native/core/notifications";

import { createWebPushChannel, vapidConfig } from "../lib/notifications/web-push";

/** Registers the Web Push channel when VAPID keys are configured (pnpm --filter @vitls/app keys:vapid). */
export default (): void => {
  const config = vapidConfig();
  if (config) registerNotificationChannel(createWebPushChannel(config));
};
