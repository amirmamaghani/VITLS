import { defineAppConfig } from "@agent-native/core/server";

import { COACH_CHANNELS } from "../../shared/channels";

export default defineAppConfig({
  app: {
    // This name appears in transactional emails. Change it to your product name.
    name: "App",
    // The source template keeps a renamed app from inheriting first-party email branding.
    sourceTemplate: "chat",
    // Keep the template's authenticated entry explicit after renaming the app.
    homePath: "/home",
    // Optional: use your own absolute HTTPS logo URL in transactional emails.
    // logoUrl: "https://example.com/logo.png",
  },
  // The coach's engine and model are deployment configuration, never a user's or an organization's choice: this layer
  // sits above the stored default, so Settings and manage-agent-engine cannot move it. Override per deployment with the
  // env aliases AGENT_ENGINE / AGENT_MODEL.
  agent: { engine: "anthropic", model: "claude-haiku-5-5" },
  // Only personal messaging channels are mounted; see shared/channels.ts.
  integrations: { platforms: [...COACH_CHANNELS] },
});
