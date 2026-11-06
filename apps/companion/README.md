# VITLS Companion

Thin Expo app that syncs Apple Health / Health Connect into VITLS through the device pairing + ingest contract
(`docs/design/02-data-model-and-ingest.md`, architecture after Open Wearables: `docs/research/05-garmin-and-companion-app.md`).

Flow: sign in with a magic link (the link opens the app via Universal/App Link and signs the Coach WebView in) → the PWA,
detecting the shell, creates a pairing code and hands it over the bridge with the signed-in e-mail → the app asks
"Send this phone's health data to <e-mail>?" and, on Pair, redeems the code for a write-only device token,
registers an Expo push token and starts background sync (expo-background-task, ~15 min). Tabs: Today (native: readout,
steps/sleep/resting HR, quick log), Coach (WebView on the PWA), Settings (device, sync, pairing-code fallback, disconnect). `src/app/+native-intent.ts` routes https links on the server origin (the magic link) and `vitls://open?url=…` into the Coach tab; `vitls://pair?code=…` still opens the native pair screen as the fallback. Push notification taps do not go through a link: `src/push.ts` opens Coach with the notification's relative `url` as a route param. Sign-in paths (`<framework auth route>`) load only from a direct https App/Universal Link; `vitls://open`, route params and push payloads carrying one fall back to Coach's start page.

Device-token routes: POST /api/ingest/v1/batches, GET /api/devices/today, POST /api/devices/log, POST|DELETE /api/devices/push.
Bridge messages ({ v: 1, type }): pair { code, email }, sync-now (web → native), sync-status (native → web). User agent suffix VITLSCompanion/<version>.

No purchase, price or upgrade path exists in the app (store rule 3.1): premium is a server flag, billing lives on the web.

Push registration stays inactive until `extra.eas.projectId` is set in `app.json` (run `eas init` before store builds).

Needs a development build (HealthKit / Health Connect are native): `npx expo run:ios` or `npx expo run:android`.
`EXPO_PUBLIC_VITLS_SERVER` is required (the app throws at startup without it); it is the Coach origin and prefills the
pair screen's server URL. Plain `http://` is accepted only in dev builds.

Disconnect (Settings, or automatically after a server-side revoke) sets a `vitls-disconnected` flag that blocks automatic
pairing from the Coach WebView until the user taps "Send sign-in link" or enters a pairing code. Limitation: the web
session in the WebView stays signed in until the user signs out in the PWA.

Not yet: anchored change tracking (sync re-reads a one-day overlap instead), deletions, quick replies, home-screen widget.

The server serves the framework's own routes (sign-in, actions, events) under the public prefix set by `runtime.frameworkRoutePrefix` in `apps/app/agent-native.config.ts` (`/_vitls`); the WebView treats every first path segment starting with `_` as that namespace, so the prefix can change without touching the app.
