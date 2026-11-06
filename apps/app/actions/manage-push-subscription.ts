import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { addSubscription, pushSubscriptionSchema, removeSubscription, vapidConfig } from "../server/lib/notifications/web-push";
import { requireOwner } from "../server/lib/ingest/owner";

export default defineAction({
  description: "UI-only: read the Web Push public key, or add/remove this browser's push subscription for the signed-in user.",
  agentTool: false,
  mcpTool: false,
  schema: z.discriminatedUnion("action", [
    z.object({ action: z.literal("config") }),
    z.object({ action: z.literal("subscribe"), subscription: pushSubscriptionSchema, label: z.string().max(100).optional() }),
    z.object({ action: z.literal("unsubscribe"), endpoint: z.string().url() }),
  ]),
  run: async (args, ctx) => {
    const { userEmail } = await requireOwner(ctx);
    const config = vapidConfig();
    if (args.action === "config") return { enabled: Boolean(config), publicKey: config?.publicKey ?? null };
    if (!config) fail("Push notifications are not configured on this server", { statusCode: 503, errorCode: "push_disabled" });
    if (args.action === "subscribe") await addSubscription(userEmail, args.subscription, args.label);
    else await removeSubscription(userEmail, args.endpoint);
    return { ok: true };
  },
});
