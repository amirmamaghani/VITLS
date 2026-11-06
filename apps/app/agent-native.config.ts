import { defineAgentNativeConfig } from "@agent-native/core/config";

export default defineAgentNativeConfig({
  changelog: { enabled: false },
  // Public namespace for the framework's own routes (auth, actions, events): no "_agent-native" in any URL users see.
  runtime: { frameworkRoutePrefix: "/_vitls" },
});
