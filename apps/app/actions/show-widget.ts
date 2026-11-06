import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { WIDGET_CATALOG, widgetSchema } from "../shared/dashboard";

/** Renders any dashboard widget inline in chat with the same component as /dashboard (registered in app/lib/register-chat-renderers.tsx). */
export default defineAction({
  description: `Show one widget inline in the chat, exactly as it looks on the dashboard: { kind, ... }. Use it to illustrate what you say; it does not change the dashboard. Call it before your reply text and don't describe where it appears.
${WIDGET_CATALOG}`,
  schema: z.object({ widget: widgetSchema }),
  http: { method: "GET" },
  readOnly: true,
  chatUI: { renderer: "vitls.widget" },
  run: async ({ widget }) => ({ widget }),
});
