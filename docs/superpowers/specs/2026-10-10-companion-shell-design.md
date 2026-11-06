# Design: companion as a thin native shell around the PWA

Date: 2026-10-10. Status: draft for review. Amends decision D11 (`docs/decisions/00-open-decisions.md`): the
companion stays thin and the PWA stays the product, but on a phone the companion becomes the single entry point.
Builds on the prototype in `apps/companion` (pairing, Health Connect / HealthKit reader, background sync).

## 1. Intent

A mobile user installs one app. It shows today's readout and numbers natively, hosts the PWA (chat, dashboards)
in a WebView, syncs the health store in the background and receives the coach's notifications as native push.
No purchase, price or upgrade path is ever visible inside the app; premium is a server flag written by Stripe.

Success:

- A new user signs in once (magic link) and ends up with a WebView session, a paired device and a first batch of
  health data without typing a pairing code.
- The coach learns on its own that data arrived and continues onboarding at the "data" stage.
- The morning readout reaches an iPhone as a native push and opens the right thread.
- The app passes App Review 4.2 (not a repackaged website) and 3.1 (no purchase in app, usable without paying),
  and Google Play's Health Connect review.
- Total code in `apps/companion` stays small: three screens, one bridge with three message types.

Assumptions confirmed by the user: thin companion, Stripe only (no IAP, no RevenueCat), free tier must be fully
usable in the app, native "Today" screen is worth building.

## 2. Companion structure

Three tabs (expo-router):

| Tab | Native / web | Content |
| --- | --- | --- |
| **Today** | native | Coach readout of the day (`save-readout` text), steps, sleep duration, resting HR for today, quick log (weight, mood), sync status line |
| **Coach** | WebView (`react-native-webview`) on the PWA | Everything else: chat, dashboards, settings of the PWA |
| **Settings** | native | Signed-in e-mail, device id, last sync / last error, Sync now, background sync status, pairing code fallback, Disconnect, privacy policy link |

The current `index` and `pair` screens are replaced by Today, Settings and a login screen. `src/sync.ts`,
`src/health.*.ts`, `src/batch.ts` stay as they are.

Today reads through one new device-token endpoint, `GET /api/devices/today`, which returns
`{ readout?: { text, date }, metrics: { steps?, sleep_min?, resting_hr? }, lastBatchAt?, missing: string[] }`.
Quick log posts to `POST /api/devices/log` `{ entries: [{ metric, value, unit?, date }] }`, which reuses the manual
ingest path (`server/lib/ingest/manual.ts`) so a phone entry is stored exactly like a chat entry (source `manual`).
Both endpoints authenticate with the device token (`requireDevice`), so the native layer has exactly one credential.

## 3. Sign-in and pairing

One sign-in covers both layers.

1. Login screen (native): e-mail field. The app calls `POST /_agent-native/auth/magic-link` on the server.
2. The e-mail link points at the PWA domain. The domain publishes `apple-app-site-association` and
   `assetlinks.json` for the magic-link verify path, so tapping the link opens the companion (Universal / App Link).
3. The companion loads that URL in the Coach WebView. Better Auth verifies it and sets the session cookie in the
   WebView's cookie store. The WebView is now signed in.
4. The PWA, when it runs in the shell (§5), calls `create-device-pairing` right after sign-in and posts
   `{ v: 1, type: "pair", code }` to the native layer. The native layer redeems it with the existing
   `pair(server, code)` (device model, platform, app version come from native) and starts background sync.
5. Fallback when the link opens in Safari / Chrome instead of the app (long-press, mail client quirks): the PWA
   shows the "connect this phone" card with a pairing code, and Settings → "Enter pairing code" accepts it. The
   WebView then still needs a sign-in: the login screen is shown again inside the Coach tab.

Server changes: none to auth itself. Two static files on the PWA domain, the `today` and `log` device routes.
The device token is never widened beyond ingest and the device routes in this spec (`today`, `log`, `push`); a
stolen device token cannot read chat or dashboards.

## 4. Bridge WebView ↔ native

`window.ReactNativeWebView.postMessage` upward, `injectJavaScript` downward. Every message is
`{ v: 1, type, ...payload }`; unknown `type` or `v` is ignored on both sides.

| Direction | type | payload | effect |
| --- | --- | --- | --- |
| web → native | `pair` | `{ code }` | native redeems the code and starts background sync (§3 step 4) |
| web → native | `sync-now` | – | native runs `sync(state)` and replies with `sync-status` |
| native → web | `sync-status` | `{ lastSyncAt?, lastError?, deviceId? }` | PWA shows it in its "devices" card |

The native layer injects `window.vitlsShell = { v: 1, platform }` before page load and appends
`VITLSCompanion/<version>` to the user agent. The PWA treats `window.vitlsShell` as "I run in the shell".

External links (`target=_blank`, other origins) open in the system browser. Android hardware back navigates the
WebView history before leaving the tab.

## 5. Shell mode in the PWA

A shared helper `isShell()` (client: `window.vitlsShell`; server: user-agent contains `VITLSCompanion/`) gates:

- **No pricing, no upgrade, no billing portal, no "buy" links** anywhere in the UI while in the shell. D9 is still
  deferred, so today this is a rule for future billing code plus one line in `extraContext` for the coach:
  "client is the mobile shell: never mention prices, plans or how to buy".
- The "connect this phone" onboarding card becomes "Pairing…" and uses the bridge instead of showing a code.
- A "Sync now" button and the device status from `sync-status` appear in the devices card.

Premium stays the single entitlement seam `server/lib/ingest/entitlements.ts` (org setting `vitls-plan`). A Stripe
webhook will write it later; nothing in the companion or PWA ever asks "how to buy", only "is premium".

## 6. Push

- `expo-notifications` in the companion obtains an Expo push token once the device is paired and registers it with
  the device token at `POST /api/devices/push` `{ expoToken }`. The server stores it in the existing user setting `vitls-push` as
  `{ kind: "expo", token, label, createdAt }` next to Web Push subscriptions (same `MAX_SUBSCRIPTIONS` cap).
- Server plugin `expo-push.ts` registers a second `NotificationChannel` (`expo-server-sdk`): delivers every
  `notify()` / `manage-notifications send` to all Expo tokens of the owner, prunes tokens the receipt marks as
  `DeviceNotRegistered`. Payload `{ title, body, data: { url } }`, `url` defaults to `/home` like Web Push.
- Tapping a notification opens the Coach tab and loads `url`. Quick replies are out of scope for this spec.
- Disconnect removes the token (`DELETE /api/devices/push`).

## 7. The coach learns that data arrived

After the ingest route stores a batch, if it is the device's first stored batch, the server calls `notify()` for
the owner with "Your phone sent N days of health data" and `url` of the onboarding thread (delivered as Web Push
and Expo push). The coach's `extraContext` gains a deterministic "devices" block: paired devices, last batch time,
days of data on the server, metrics the user's goals need that no source provides (computed from the metric catalog
vs. `daily_metrics` / `point_metrics`). With that in context the coach continues the "data" onboarding stage on
the next turn without being asked, and can tell a Garmin user which Health Connect toggles are missing.

No message is injected into a chat thread programmatically; the notification brings the user back, the context
tells the coach what happened.

## 8. Store compliance checklist (part of the deliverable)

- App Review notes: companion to a web service; native features: Apple Health / Health Connect sync, background
  sync, native push, Today screen, quick log; all features free; subscriptions are managed on the website and are
  not sold or referenced in the app. Test account with a paired device and 14 days of data.
- Privacy policy URL in both store listings and in Settings; "not medical advice" line on Today.
- iOS: `NSHealthShareUsageDescription` wording per data type purpose; HealthKit data never used for ads.
- Android: Play Console Health Connect declaration (data types, purposes, privacy policy), separate justification
  for `READ_HEALTH_DATA_IN_BACKGROUND`.
- Universal Links / App Links: AASA and assetlinks served over HTTPS from the PWA domain, verified with
  `swcutil` / `adb shell pm verify-app-links` before submission.

## 9. Error handling

- Bridge messages that fail validation are dropped silently; the PWA never assumes a reply.
- Magic link opened outside the app → fallback pairing code (§3 step 5); the WebView shows the PWA login page.
- `today` / `log` / `push` routes return 401 on a revoked device; the app then clears its state and shows the login
  screen (same behaviour as a failed sync today).
- Push delivery failure never fails the notification: the channel returns `false`, the framework keeps the in-app
  notification.

## 10. Testing

- Server unit tests: `today` and `log` route handlers (scoping to the device owner, manual source), Expo channel
  (delivery, `DeviceNotRegistered` pruning), first-batch notification (fires once per device), `isShell()` detection,
  devices block in `extraContext`.
- Companion: `tsc`, `expo export`; on-device dev build on Android (this project's current test path): sign-in via
  App Link, automatic pairing, Today screen with real data, quick log round trip into `daily_metrics`, push tap
  opening a thread, background task via "Run background task now (dev)".
- iOS: same on a physical device before the first TestFlight build.

## 11. Out of scope (later specs)

Home-screen widget, quick replies in notifications, meal photo capture, write-back to Health Connect / HealthKit,
Samsung Health provider, on-device Garmin connector (D4 unchanged), Stripe webhook and billing UI (D9).
