# Design: the VITLS coach (onboarding, personas, memory, readout, physiology)

Status: **APPROVED, revised native-first** · 2026-10-01
Study basis (agent-native-first step 1): core 0.198.8 `agent-chat-plugin` (systemPrompt / `extraContext` / `registerPromptContextProvider`
/ `resolveActionSurface` / `frameworkTools`), `context-tools` (`ask-question`), `jobs/*` (frontmatter incl. `timezone`, scheduler,
Netlify driver), `notifications` (`notify`, `registerNotificationChannel`), `skills-guide` (runtime skills), `resources/store`;
corpus `factory` (programmatic per-owner jobs); getmedoc2 intake playbook (`AGENTS.md` stages, `suggest-replies`, `resolveActionSurface`).
Decisions used: D5–D8, D7 details (docs/decisions/00-open-decisions.md).

## 1. Principles

- **Goal-agnostic and composable.** A user has 1..n goal modules; nothing assumes weight loss.
- **The database is the truth**, not the conversation: every turn starts from the coach profile (injected automatically, §3).
- **Coach, not doctor — enforced by tool surface**, not only by prompt (getmedoc containment doctrine).
- **Numbers come from code, words from the model.** Trends, baselines and reframes (water vs fat, HRV deviation) are computed
  deterministically in `packages/physiology` and returned by read actions; the LLM interprets, never calculates.
- **Device text is untrusted data.** It is already normalized at ingest (§11 of spec 02); the coach prompt treats it as quoted data.
- **User's language** for all coach output; UI stays English.

## 2. Data — framework stores only, no new tables

| Data | Native store | Shape |
|---|---|---|
| Coach profile | user setting `vitls-coach` (`getUserSetting` / `mutateUserSetting`) | `{ persona, strictness, language, timezone, units, readoutTime, onboardingStage, goals: [{ module, priority, targets, context }] }` validated by one zod schema |
| Coach memory (injuries, conditions, life events, preferences) | framework memory: `save-memory` → personal `memory/*.md` + `memory/MEMORY.md`; user edits it in the agent panel **Resources** tab | framework types `user` / `feedback` / `project` / `reference` |
| Web Push subscriptions | user setting `vitls-push` | `{ subscriptions: [{ endpoint, keys, label, createdAt }] }` |
| Readout schedule | personal job resource `jobs/morning-readout.md` | framework job frontmatter |

The `coach_facts` table (migration v9) is dropped from the schema and identity registry; the empty table stays because migrations
are additive-only.

## 3. Prompt composition

- **`systemPrompt`** (replaces the framework prompt): identity, hard safety rules (§8), data rules (DB is truth, never invent numbers,
  quote device text), language rule.
- **Repo `AGENTS.md`**: the onboarding stage playbook (§4) and tool usage guide (getmedoc pattern).
- **`extraContext(event, owner)`** — per turn, from the DB: onboarding stage, active goals, persona + strictness, language, units,
  timezone, today's date in the user's zone, list of coach fact *kinds* with staleness flags (not their contents).
- **Runtime skills** in `apps/app/.agents/skills/*/SKILL.md` (`scope: runtime`), loaded on demand:
  `coach-intake`, `coach-personas` (voice rules + recommendation rubric), `morning-readout`, `physiology-reframes`
  (water/glycogen, HRV drivers, DOMS, plateau math), and one per goal module (`goal-fat-loss`, `goal-muscle-gain`, `goal-endurance`,
  `goal-vo2max`, `goal-strength`, `goal-swim`, `goal-longevity`).

## 4. Onboarding (short quiz + progressive enrichment)

Detection: `vitls-coach.onboardingStage != "done"`. The chat empty state (AgentKit `emptyState` slot) auto-sends a hidden kickoff
via `controller.sendMessage` for new users. Questions use the built-in **`ask-question`** tool (already rendered by `GuidedQuestionFlow`).

| Stage | What | Writes |
|---|---|---|
| 0 Welcome | Detect language from the first reply; one-line promise; consent reminder (health data, not medical advice) | `language` |
| 1 Goals | Multi-select goal modules + priority; one target question per chosen module | `goals` |
| 2 Starting point | Experience level, current training frequency, rough schedule | `goals[].context` |
| 3 Constraints | Injuries, conditions, medication (optional, "skip" allowed) | memory (`save-memory`) |
| 4 Coaching style | 2 questions (how you respond to pressure, what motivates you) → coach **recommends a persona** with a one-line why → user confirms/switches; strictness dial | `persona`, `strictness` |
| 5 Rhythm | Morning readout time + timezone (default from browser), units | `readout_time`, `timezone`, `units` → creates the readout job |
| 6 Data | Explain companion app; create pairing code (approval-gated) or skip | — |
| 7 First dashboard | Agent composes the first dashboard from goals (spec 04) | dashboard |

Anything skipped is collected later "just in time" (e.g. the coach asks about injuries before the first strength plan).

## 5. Personas & goal modules — data, not code paths

`shared/coach.ts` holds two plain records used by UI and agent: `PERSONAS` (`strict`, `scientist`, `supportive`, `longevity`:
name, voice rules, default strictness) and `GOAL_MODULES` (key, label, relevant metric keys, target fields). Coaching knowledge per
goal lives in runtime skills, not code. Strictness is a separate dial.

## 6. Actions — three

| Action | Notes |
|---|---|
| `get-coach-profile` (read) | profile setting + derived flags (onboarded?, readout scheduled?) |
| `update-coach-profile` (write, patch) | validates, writes the setting, (re)writes or removes the personal readout job |
| `get-health` (read) | one orthogonal read tool: `{ from, to, include: ["daily","points","sleep","workouts"], metrics? }` → source-resolved values + physiology summaries; result-size capped |

Everything else is native: questions via `ask-question`, memory via `save-memory`, readout delivery via `manage-notifications send`
(runs every registered channel incl. Web Push), scheduling via the job resource. UI-only push registration writes the `vitls-push`
setting through `update-coach-profile`'s sibling path in the client (settings hook) — no extra action. Template leftovers removed:
`hello`, `provider-api-request`.

## 7. Memory & tool surface

- **Native memory is the coach's memory** (user decision 2026-10-01): `save-memory` stays on; the coach writes injuries, life events
  and preferences there and verifies stale entries before acting on them. Accepted risk: framework memory and chat threads are
  protected by row scoping + DB-at-rest encryption, not field encryption (decision c).
- `frameworkTools`: `database: "off"` (reads only through `get-health`; no raw SQL over health tables), `chat: false` (BYOK/model
  management stays in Settings), `automation: true` (readout jobs), notifications on.

## 8. Safety rules (non-negotiable, in `systemPrompt` + tests)

- No diagnosis, no medication changes, no supplement dosing beyond general guidance; refer to a clinician.
- **Red flags → stop coaching, advise urgent care**: chest pain, fainting, shortness of breath at rest, signs of eating disorder,
  pregnancy-related concerns, severe/persistent pain.
- **Eating-disorder guard**: refuse aggressive deficits when weight trend or targets imply underweight (BMI < 18.5) or loss
  > 1 %/week sustained; persona sets the tone on food too: blunt about numbers is fine, attacking the person or moralising food is not (docs/design/06-nutrition.md §5).
- Never push through pain; injury facts modify plans.
- Never invent data; if a metric is missing, say so and ask.

## 9. Morning readout

- `update-coach-profile` writes a **personal-scope job** `jobs/morning-readout.md` via `resourcePut(userEmail, …)`:
  `schedule` from `readout_time`, `timezone` from the profile, `runAs: creator`, cheaper `model`, body = "Run the morning-readout skill".
- Skill `morning-readout`: `get-health` (last night + 7/30-day context) → interpret with physiology reframes in the persona's
  voice → one specific directive for today (autoregulated by HRV/sleep) → `manage-notifications send`.
- Delivery: the run's chat thread + inbox + **Web Push**: one `registerNotificationChannel("webpush")` reading the `vitls-push`
  setting, VAPID keys from env, PWA service worker + manifest. Requires `A2A_SECRET` for the Netlify job driver; local dev needs
  `AGENT_NATIVE_ENABLE_LOCAL_RECURRING_JOBS=1`.

## 10. Physiology engine (`packages/physiology`, pure TS, tested)

EMA trend + 30/90-day MAs; raw-minus-trend water offset; fat-change plausibility (7,700 kcal/kg; ~0.1–0.2 kg/day ceiling);
HRV baseline (60-day) vs 7-day mean with deviation bands; resting-HR deviation; sleep debt vs personal baseline;
training load vs recovery → readiness hint (from platform readiness when present). All values are platform-reported (D8);
the engine only smooths and compares.

## 11. Testing

Unit: physiology functions, profile schema + `update-coach-profile` (job writer: cron/timezone), `get-health` (scoping, source resolution).
Agent behaviour: scripted conversation fixtures for onboarding stages and safety refusals (red flags, ED guard) — run as
evals later (getmedoc `sim` concept).

## 12. Implementation order

1. `packages/physiology` (+ tests) → 2. profile setting + `get-/update-coach-profile` → 3. `get-health` → 4. prompt composition
(`systemPrompt`, `extraContext`, AGENTS.md playbook, runtime skills, tool surface) → 5. onboarding kickoff in the chat empty state →
6. readout job → 7. Web Push channel + PWA service worker → 8. remove template leftovers and `coach_facts` from the schema.

## 13. Reducing-entropy check

Mindset: *data over abstractions* — one profile record, one memory store, one read tool.
Draft v1 → revised: tables 2 → 0 (profile + push in settings, memory native), actions 9 → 3 (`send-readout`, fact CRUD,
`list-workouts`, `get-sleep`, push actions removed), deleted: `coach_facts` usage, template `hello` / `provider-api-request`.
