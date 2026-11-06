import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listDevices } from "../server/lib/ingest/devices";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "List the signed-in user's paired devices and data sources (label, platform, created, last used, revoked).",
  schema: z.object({}),
  http: { method: "GET" },
  run: async (_args, ctx) => ({ devices: await listDevices(await requireOwner(ctx)) }),
});
