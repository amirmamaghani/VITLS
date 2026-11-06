/** DELETE /api/devices/push — the companion removes its Expo push token (disconnect). Auth: device token. */
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { deviceRoute, requireDevice } from "../../../lib/ingest/http";
import { removeExpoToken } from "../../../lib/notifications/web-push";

const bodySchema = z.object({ expoToken: z.string().min(10).max(200) });

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    const { expoToken } = bodySchema.parse(await readBodyWithSizeLimit(event, 2 * 1024));
    await removeExpoToken(identity.userEmail, expoToken);
    return { ok: true };
  }),
);
