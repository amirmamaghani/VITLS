# Decisions log

Answers given by the user on 2026-10-01. Status per item: **DECIDED**, **RESEARCHING**, or **DEFERRED**.

## Framework-dictated (flagged conflicts with the build prompt; `agent-native-first` wins)

1. **Organizations:** Better Auth handles sign-in only; tenants/roles/invitations use the framework's own `org/` module + `defineAppRoles` (not the Better Auth organization plugin).
2. **DB/ORM:** Postgres (PGlite locally) + Drizzle via `@agent-native/core/db`.
3. **Shared packages:** start minimal (see D1) under `reducing-entropy`.

## D1 Monorepo — DECIDED
pnpm + Turborepo scaffolded via `npx create-turbo`; agent-native app via `npx @agent-native/core create --standalone`.
Layout: `apps/app` (agent-native), `apps/web` (placeholder, deferred), `packages/physiology` (pure TS, framework-free, unit-tested).
More packages only when a second consumer exists. Always prefer official CLIs/generators over hand-written scaffolding.

## D2 LLM / hosting — DECIDED
- **Bring-your-own-key must be supported.** agent-native already provides per-org and per-user provider keys and model selection
  (Settings › Model; `manage-provider-key-policy`, `set-agent-engine`). Use it; do not build a custom key store.
- Managed default engine: Anthropic. Hosting: EU (see D10). Concrete host (Netlify vs other) to be confirmed at deploy time.

## D3 Reused skills — DECIDED
Shortlist in `docs/research/02-reuse-shortlist.md` approved.

## D4 Wearables — DECIDED (research: `docs/research/04-wearables-options.md`, `05-garmin-and-companion-app.md`)
- Terra rejected (cost). Open Wearables used as **inspiration**, not deployed (user, 2026-10-01).
- v1 priority: **Garmin, Apple Health, Android Health Connect**; others later via the provider-abstraction layer.
- Own TS provider layer + ingest contract in `apps/app`; **thin Expo companion app** (see D11) syncs HealthKit / Health Connect,
  following the Open Wearables companion architecture (pairing → user-scoped write token, anchored/changes-token background sync, outbox, server dedupe).
- **Garmin goes through the companion too** (Garmin Connect → Apple Health / Health Connect). No gccli-style connector, no stored Garmin credentials.

## D5 Multitenancy — DECIDED
Org = workspace. Every user gets a personal org. An org can also be a coaching business with app roles `coach` and `client`.
Multi-org membership allowed. All data org-scoped.

## D6 Dashboards — DECIDED
**The AI agent designs the dashboards** (no fixed per-goal default layouts). Built on agent-native `dashboard-storage`
(JSON config in SQL, revisions/undo, sharing) with an agent-facing mutation API in the style of the analytics template
(`compose` / `mutate` / `reorder`) — the same approach quantal already uses. The agent composes from typed primitives
(chart type × normalized metric query × time range); the user can still edit by hand or by asking the coach.

## D7 Coach persona — DECIDED
Users choose from **multiple coach personas** as part of the onboarding quiz. The agent proposes a persona based on the quiz answers,
guided by a persona skill + rules (defined as agent-native skills/instructions). Containment ("coach, not doctor") enforced via tool surface.

### D7 details (2026-10-01)
- v1 personas: **Strict / Drill**, **Scientist**, **Supportive**, **Longevity mentor**; the agent recommends one from quiz answers, the user confirms or switches anytime.
- Coach language: **the user's language** (from their messages or profile setting); UI stays English (i18n later).
- Morning readout delivery: **in-app** (new chat thread + inbox notification) and **Web Push (PWA)** — custom notification channel.
- Onboarding quiz: **short** (5–7 questions: goals, experience, constraints, coaching style); the coach fills gaps progressively in conversation.

## D8 Body composition — DECIDED
No VITLS-owned body-composition models. Body-fat, muscle mass, etc. are taken **as reported by the fitness platforms**
(Garmin, Apple Health, …). Presentation-level smoothing (trend lines, moving averages) is still allowed.

## D9 Pricing — DEFERRED
Will be BYOK and/or managed; monetisation decided later. Keep one entitlement seam in code.

## D10 Hosting & security — DECIDED
EU hosting for all data. Encryption is required: at rest (DB/storage), in transit, plus application-level encryption for
sensitive fields/secrets (design TBD in a dedicated security doc).

## D11 Client platform — DECIDED
Main product is a **PWA built purely on agent-native**. Plus a **thin Expo (React Native) companion app** in `apps/companion`, used only for
health-store sync (pairing, permissions, sync status, disconnect), because a PWA cannot read Apple Health / Health Connect.
- **Amendment 2026-10-10** (`docs/superpowers/specs/2026-10-10-companion-shell-design.md`): on a phone the companion is the
  single entry point: native Today screen + Settings, the PWA in a WebView, native push, one magic-link sign-in that also pairs
  the device. Still no chat or dashboards implemented natively. **No purchase in the app** (no IAP, no RevenueCat): premium is
  the server entitlement flag, billing is Stripe on the web, and the PWA hides every price and upgrade path when it runs in
  the shell; the free tier must be fully usable in the app.

## D12 Time-series storage — DECIDED (2026-10-01)
**TimescaleDB from the start** (user decision, over the recommendation to defer). Local infra uses
`timescale/timescaledb-ha:pg17` (TimescaleDB + pgvector). `daily_metrics`, `point_metrics` and `intraday_series`
are hypertables (migration v11, skipped where the extension is unavailable, e.g. PGlite tests); intraday chunks
compress after 30 days. Measured times are `TIMESTAMPTZ`, days `DATE`, keys include the time column (no surrogate ids).
Production hosting must provide TimescaleDB in the EU (Timescale Cloud EU or self-hosted). Details: infra skill.
