/** POST /api/devices/log — quick manual entries from the companion's Today screen. Auth: device token. */
import { ActionContractError } from "@agent-native/core/action";
import { readBodyWithSizeLimit } from "@agent-native/core/server";
import { defineEventHandler } from "h3";
import { z } from "zod";

import { deviceRoute, requireDevice } from "../../../lib/ingest/http";
import { logManual, ManualEntryError } from "../../../lib/ingest/manual";

const bodySchema = z.object({
  entries: z
    .array(z.object({ metric: z.string().min(1).max(40), value: z.number().finite(), unit: z.string().max(20).optional(), date: z.string().min(10).max(40) }))
    .min(1)
    .max(20),
});

export default defineEventHandler((event) =>
  deviceRoute(event, async () => {
    const identity = await requireDevice(event);
    const { entries } = bodySchema.parse(await readBodyWithSizeLimit(event, 8 * 1024));
    try {
      const result = await logManual(identity, { entries: entries.map((e) => ({ metric: e.metric, value: e.value, unit: e.unit, when: e.date })) });
      return { stored: result.stored.daily + result.stored.points };
    } catch (error) {
      if (error instanceof ManualEntryError) throw new ActionContractError(error.message, { errorCode: "invalid_entry", statusCode: 400 });
      throw error;
    }
  }),
);
