/** GET /api/devices/today — the companion's native Today screen. Auth: device token. */
import { defineEventHandler } from "h3";

import { getToday } from "../../../lib/devices/today";
import { deviceRoute, requireDevice } from "../../../lib/ingest/http";

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    return getToday(identity);
  }),
);
