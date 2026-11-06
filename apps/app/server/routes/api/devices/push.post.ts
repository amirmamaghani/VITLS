/** POST /api/devices/push — the companion registers its Expo push token. Auth: device token. */
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { deviceLabelSchema } from "@vitls/health-ingest";

import { deviceRoute, requireDevice } from "../../../lib/ingest/http";
import { isExpoPushToken } from "../../../lib/notifications/expo-push";
import { addExpoToken } from "../../../lib/notifications/web-push";

const bodySchema = z.object({ expoToken: z.string().min(10).max(200).refine(isExpoPushToken, "Not an Expo push token"), label: deviceLabelSchema.optional() });

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    const { expoToken, label } = bodySchema.parse(await readBodyWithSizeLimit(event, 2 * 1024));
    await addExpoToken(identity.userEmail, expoToken, label, identity.deviceId);
    return { ok: true };
  }),
);
