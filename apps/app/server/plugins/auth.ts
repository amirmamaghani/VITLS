import { createAuthPlugin } from "@agent-native/core/server";

export default createAuthPlugin({
  workspaceAppPublicPaths: ["/"],
  rootAuth: true,
  marketing: false,
  // Device-facing endpoints authenticate with pairing codes / device tokens, never cookies.
  // See docs/design/02-data-model-and-ingest.md §5.
  publicPaths: [
    // Device-token routes authenticate inside the handler (requireDevice); sign-in and redeem are throttled and public.
    "/api/devices/redeem",
    "/api/devices/sign-in",
    "/api/devices/today",
    "/api/devices/log",
    "/api/devices/push",
    "/api/ingest/v1/batches",
  ],
});
