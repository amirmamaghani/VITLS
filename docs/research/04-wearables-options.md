# Wearable ingestion options (researched 2026-10-01)

Constraints: Terra rejected (cost) · **PWA only, no own native app** · EU hosting · v1 priority Garmin, Apple Health, Health Connect.

## Key facts

- **Apple HealthKit and Android Health Connect have no web/cloud API.** A PWA cannot read them. Data can only reach us via
  *some* app installed on the phone (ours — excluded — or a third party's), or via manual export-file upload.
- **Garmin Connect Developer Program has paused new applications** (spring 2026, no reopening date). Existing partners keep working.
  Unofficial libraries (garth — deprecated; python-garminconnect — broken by Cloudflare TLS fingerprinting) violate ToS and require
  storing user passwords → **not acceptable**.
- **Google Fit APIs end at end of 2026**; Fitbit Web API is replaced by the **Google Health API** (cloud OAuth, works from a PWA,
  also exposes third-party device data via Health Connect; restricted scopes → Google security review, unknown timeline).

## Open-source aggregator: Open Wearables

[the-momentum/open-wearables](https://github.com/the-momentum/open-wearables) — the only serious OSS option.
MIT; Python FastAPI + Postgres + Redis + Celery; Docker images; ~2.6k stars; active (v0.9.0, 2026-09-17), **pre-1.0 with breaking releases**.

- Cloud providers: Garmin*, Oura, Whoop, Suunto, Polar, Ultrahuman, Strava, Fitbit/Google Health, Withings. (*needs our own Garmin developer credentials.)
- Phone SDKs: HealthKit, Health Connect, Samsung Health; Apple Health XML import.
- **Ready-made companion app** (user enters our server URL + invite code, background sync) — **beta** (TestFlight/APK via Discord; store release "coming soon").
- Normalized REST API, webhooks, MCP server.
- **Single-tenant**: we map our org/users onto OW users, or run one instance per tenant.
- Integration shape: separate EU-hosted service; our Node app consumes its REST API + webhooks.

## Commercial (context only, indicative prices)

Terra from $399/mo · ROOK $399/mo (750 users) + add-ons · Sahha $299/mo (1,000 users) · Spike from $450/mo ·
Junction/Vital no public pricing · **Thryve €499/mo (500 users), EU-based, EU residency, already has Garmin access.**

## PWA-only paths to phone health stores (ranked)

| # | Path | UX | Reliability | Cost | EU privacy |
|---|---|---|---|---|---|
| 1 | Cloud OAuth to device vendors (Oura, Whoop, Polar, Withings, Strava, Google Health API; Garmin if access reopens) | Best | High | Mostly free | Good |
| 2 | Open Wearables companion app → our server | Good (once public) | Medium (beta; iOS syncs only when unlocked) | Free | Good, but third-party app |
| 3 | Bridge apps: Health Auto Export (iOS, ~$6/yr) / health-connect-webhook (Android, AGPL) → per-user ingest URL | Fair | Medium | User pays little | Fair (no DPA with app vendor) |
| 4 | Apple Shortcuts automation POSTing samples | Poor | Low | Free | Good |
| 5 | Export-file upload (Apple `export.zip`, Health Connect `.zip` SQLite) | Poor, manual | High per upload | Free | Good |

## Recommended v1 architecture (proposal)

1. **Own TypeScript provider-abstraction layer** (`HealthProvider`: authorize / handleWebhook / backfill / normalize) writing to
   a canonical org-scoped schema (samples, daily summaries, sleep sessions, workouts; source provider/device; dedupe key; raw payload archived encrypted).
2. **Open Wearables as an internal EU service** behind one adapter (version-pinned) — gives cloud providers + companion-app/SDK ingestion at zero licence cost; swappable.
3. **Garmin:** join the waitlist; meanwhile reach Garmin users indirectly (Garmin Connect → Apple Health / Health Connect via path 2/3, activities via Strava).
   If Garmin is a launch must-have: Thryve as a paid EU stopgap for Garmin only.
4. **Apple Health / Health Connect:** OW companion app (primary when public); generic signed per-user ingest endpoint for bridge apps (interim); export-file upload (backfill).
5. Onboarding lists cloud-OAuth providers first; start Google Health API restricted-scope review early.

## Risks

Garmin pause · iOS coverage depends on a third-party app and unlocked-phone sync · OW is beta, single-tenant, adds a Python runtime ·
Google review timeline · third-party bridge apps need DPIA/consent coverage.
