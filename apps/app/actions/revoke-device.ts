import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { revokeDevice } from "../server/lib/ingest/devices";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "Revoke one of the signed-in user's paired devices so it can no longer send health data. Already stored data is kept.",
  schema: z.object({ id: z.string().min(1).describe("Device id from list-devices") }),
  needsApproval: true,
  run: async ({ id }, ctx) => {
    await revokeDevice(await requireOwner(ctx), id);
    return { id, message: "Device revoked." };
  },
});
