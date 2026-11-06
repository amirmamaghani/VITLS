import { agentNative } from "@agent-native/core/vite";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vite";

import { vitlsTheme } from "./app/design-system-theme";

const reactRouterPlugins = reactRouter as unknown as () => any[];
const agentNativePlugins = agentNative as unknown as (
  options?: Parameters<typeof agentNative>[0],
) => any[];
export default defineConfig({
  optimizeDeps: {
    entries: [
      "app/entry.client.tsx",
      "app/root.tsx",
      "app/components/layout/Layout.tsx",
      "app/routes/home.tsx",
    ],
    // agent-native turns dependency discovery off; without this the AgentSidebar entry is served unbundled with a second
    // chat renderer registry that never sees our renderers. Sidebar widget cards also need the upstream widget-slot fix
    // (docs/upstream/agent-native-sidebar-action-widget-slot.md).
    include: ["@agent-native/toolkit/app/chat"],
  },
  plugins: [
    ...reactRouterPlugins(),
    ...agentNativePlugins({
      ssrStubs: ["shiki"],
      designSystemTheme: vitlsTheme,
    }),
  ],
});
