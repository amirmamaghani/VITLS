import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createPairing } from "../server/lib/ingest/devices";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description:
    "Create a one-time code (valid 10 minutes) that pairs the VITLS companion app or a dev data source with the signed-in user's account. Returns the code, a vitls:// deep link and expiry; show the code to the user once.",
  schema: z.object({}),
  audit: { recordInputs: false },
  // A pairing code mints a long-lived device credential: never via external MCP clients, and the in-app
  // agent must get explicit human approval (guards against prompt-injected requests).
  mcpTool: false,
  needsApproval: true,
  run: async (_args, ctx) => {
    const owner = await requireOwner(ctx);
    const { code, expiresAt } = await createPairing(owner);
    return {
      code,
      expiresAt,
      deepLink: `vitls://pair?code=${encodeURIComponent(code)}`,
      message: `Pairing code ${code} is valid until ${expiresAt}.`,
    };
  },
});
