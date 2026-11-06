# Garmin via gccli approach & companion app (researched 2026-10-01)

## A. gccli (https://github.com/bpauli/gccli)

- Go 1.25, MIT, actively maintained (v1.10.0 2026-08-31). API surface modelled on python-garminconnect (~113 methods on `connectapi.garmin.com`).
- **Auth:** default *browser login* — local callback server, user signs in on `sso.garmin.com` (incl. MFA), Garmin redirects with a one-time
  `ticket` → **gccli never sees the password**. Ticket is exchanged at `diauth.garmin.com/di-oauth2-service/oauth/token` presenting as the
  Garmin Connect Android app (hard-coded `client_id`, spoofed app headers) → Bearer access token (~1 day) + single-use refresh token.
- Survived the March 2026 change without TLS impersonation (plain Go `net/http`); Node `fetch`/undici reportedly blocked by Cloudflare fingerprinting — must be tested.
- Code is under Go `internal/` → not importable; reuse = fork as sidecar or port ~600 lines of auth to TS.
  MIT TS client exists (`garminconnect-js`) but uses the pre-2026 OAuth1 flow.

### Risks of using it for many users server-side
ToS violation (impersonates Garmin's app) · single point of breakage when Garmin rotates client IDs / Cloudflare rules ·
datacenter IP rate-limiting/blocking · VITLS would hold long-lived refresh tokens to users' whole Garmin accounts (Art. 9 data, DPIA) ·
official Developer Program paused (no alternative today).

### Safer variant
Run the gccli-style flow **on the user's device inside the companion app**: in-app WebView login captures the ticket, token exchange
and API calls happen on the phone (native TLS stack, residential IP), only normalized data is uploaded. VITLS never holds Garmin
credentials or tokens. Opt-in, labelled experimental, with a remote kill switch. Covers Garmin-only metrics (Body Battery, stress,
training readiness, HRV status) that Garmin does not write to Apple Health / Health Connect.

## B. Companion app (inspired by Open Wearables)

OW's companion app is a thin wrapper around native SDKs (Swift iOS SDK, Kotlin Android SDK; RN/Flutter wrappers), all MIT.

- **Pairing:** backend mints a user-scoped token; app stores it in Keychain / EncryptedSharedPreferences; tokens can only write that user's data.
- **iOS sync:** `HKObserverQuery` + background delivery, per-type `HKAnchoredObjectQuery` anchors (incl. deletions), BGTasks, background URLSession,
  chunking (2000 fg / 100 bg), file outbox with retries; anchors advance only after 2xx.
- **Android sync:** Health Connect changes tokens (30-day catch-up when expired), WorkManager every 15 min as foreground health service, quota backoff;
  needs `READ_HEALTH_DATA_IN_BACKGROUND` + Play health-apps declaration.
- **Payload:** `{ records[], sleep[], workouts[] }` with platform UUID as id, type, start/end, zone offset, value/unit, source (app, device, OS).
- **Server:** 202 + async processing; dedupe on (source, series type, recorded_at) + external id.

### Wrapper vs. separate companion

| | Capacitor wrapper of the PWA | Thin companion app |
|---|---|---|
| App Review 4.2 (web wrapper) | Real rejection risk | Low (narrow, clear purpose) |
| Background sync | No maintained Capacitor plugin does it → custom native code anyway | Native SDK pattern (OW) |
| Release coupling | Every web deploy must stay shell-compatible | PWA ships independently |
| Payments rule 3.1 | Applies if subscriptions visible | Not touched |

**Recommendation:** thin companion app (Expo, wrapping OW-style native SDKs or OW SDKs directly), pairing via short-lived code / QR / deep link
from the logged-in PWA; ingest contract implemented in our Node app (no Python service needed) with Postgres dedupe.
Garmin: Apple Health / Health Connect first (no ToS risk); optional on-device gccli-style connector for Garmin-only metrics.
