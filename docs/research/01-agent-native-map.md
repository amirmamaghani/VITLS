# agent-native subsystem map (v0.195.0)

Source of truth: installed `@agent-native/core` 0.195.0 / `toolkit` 0.22.3 / `agentkit` 0.4.1
(in `../quantal/apps/agent/node_modules/@agent-native/*`), its `docs/content/*.mdx` and the
template corpus `corpus/templates/*`. Re-verify against the version VITLS installs.

## 1. Shared actions (the spine)

- `actions/<name>.ts` → `defineAction({ description, schema, outputSchema?, run })`; auto-discovered, filename = action name.
- One `run(args, ctx)` serves every surface: agent tool, `POST /_agent-native/actions/<name>`, React
  (`useActionQuery`/`useActionMutation`), CLI (`pnpm action <name>`), MCP, A2A, automations.
- `ctx`: `userEmail`, `orgId`, `caller`, `attachments` (images from the chat turn), `threadId/runId/turnId`, `signal`.
- Access: `agentTool`, `mcpTool`, `needsApproval`, `authorize` (app roles via `defineAppRoles`),
  row-level `accessFilter` / `assertAccess`. Pipeline: validate → authorize → run → validate output → audit.
- Errors via `fail(msg, { statusCode })`. Mutations are audited automatically (append-only, tenant-scoped).

## 2. Agent chat & LLM engines

- Pluggable engines: `anthropic`, `ai-sdk:{anthropic,openai,openrouter,google,groq,mistral,cohere,ollama}`, `builder`.
- Default Anthropic model: `claude-sonnet-5`. Engine resolution: plugin option → `AGENT_ENGINE` → app default → org setting → stored keys → env keys → `anthropic`.
- Per-org keys/models in Settings › Model. Vision supported on the main engines.
- `createAgentChatPlugin({ resolveOrgId, resolveActionSurface, frameworkTools, ... })` controls the tool surface per caller.

## 3. Skills & memory

- Everything is a *resource* row (`path + scope + content`) in SQL; scopes: workspace, org/shared, personal (`u:<email>`).
- Loaded every turn: `AGENTS.md`, `instructions/*.md`, skill descriptions (`skills/<slug>/SKILL.md` bodies on demand), `context/*.md` index.
- Memory: shared `LEARNINGS.md` + personal `memory/MEMORY.md` index with typed topic files
  (user/feedback/project/reference) written by a `save-memory` tool. Users see/edit them in the agent panel **Resources** tab.
- Observational Memory compacts long threads (observations → reflections), scoped per owner/org.
- **VITLS implication:** coach memory (injuries, scan anchors, lifestyle events, preferences) can live in personal
  memory resources; structured facts that widgets/math depend on (goals, anchors, settings) belong in SQL tables.

## 4. Auth & multitenancy

- Better Auth is mounted by core (`/_agent-native/auth/ba/*`): magic link / email OTP, social providers, bearer/JWT, OAuth 2.1 for MCP.
- **Organizations are the framework's own `org/` module, NOT Better Auth's organization plugin.**
  Tables `organizations`, `org_members`, `org_invitations`, `app_member_roles`; org roles `owner|admin|member`;
  invitations, multi-org membership + switching, domain auto-join; personal org auto-created (`AUTO_CREATE_DEFAULT_ORG`).
- App-specific roles overlay via `defineAppRoles` (the docs' own example is a "coach" app); UI via `OrgSwitcher`, `TeamPage`, `useAppRole`.
- Scoping: `session.orgId → ctx.orgId`; `ownableColumns()` (`owner_email`, `org_id`, `visibility`) + `accessFilter`;
  agent SQL runs over filtered views; `agent-native doctor` guard `no-unscoped-queries`.

## 5. Database

- Postgres only. PGlite for local dev (`DATABASE_URL` unset or `pglite:`), hosted Postgres in prod (Neon/Supabase/RDS…).
- Drizzle via `@agent-native/core/db/schema`; `createGetDb(schema)`; migrations via `runMigrations([...])` (append-only SQL) or drizzle-kit.
- Production: run migrations in a release step (`withMigrationRuntime(runFrameworkReleaseMigrations)`, `AGENT_NATIVE_RELEASE_MIGRATIONS=1`) — quantal learned this from a cold-start outage.
- Core stores: `application_state` (UI↔agent navigation/selection), `settings`, `oauth_tokens`, `sessions`.

## 6. Agent-configured UI / dashboards (central for VITLS)

| Mechanism | What it is | Fit for VITLS |
|---|---|---|
| `@agent-native/core/dashboard-storage` | Dashboards as validated JSON config in SQL, with revisions, sharing, optimistic concurrency; revisions record the agent turn that changed them | **Primary.** Goal-driven layout = agent writes a typed `{ widgets: [{ id, type, params, size }] }` config |
| `@agent-native/toolkit/dashboard` | `MetricCard`, `StatsCard`, `GenericChartPanel`, `DataTable`, `DateRangePicker`, layout | Base widget primitives |
| CRM template (`save-crm-dashboard`) | Minimal reference: zod config, ≤12 panels | Copy as starting point |
| Analytics template | Full grid, `mutate-dashboard`/`compose-dashboard`/`reorder-dashboard-panels` actions | Copy the mutation-action pattern |
| Native chat widgets (`chatUI.renderer` + `data-widgets`) | Same widget rendered inline in chat | Coach can reference/show any widget in chat |
| Data programs | Agent-written sandboxed JS aggregations bound to panels | Later: user-specific custom metrics |
| Extensions / generative UI (Alpine iframes, slots) | Agent-authored mini-apps, off by default | Later / optional |
| Self-modifying code | Dev only | Not a production mechanism |

Quantal already applies the first pattern: `shared/dashboard.ts` (widget = whitelisted read-only action + params, max 24), `createDashboardStorage`, live refresh via Postgres LISTEN → `recordChange` → `useChangeVersion`.

## 7. Automations, notifications, delegation, realtime

- Automations: resource files `jobs/<name>.md` with cron or event trigger; body is a prompt run as a full agent loop (`runAs`, `model`). Docs' example `morning-digest` ≈ VITLS morning readout.
  Caveat: in-process 60 s scheduler; Netlify build emits a scheduled function as durable driver; Vercel equivalent not confirmed.
- Notifications: inbox, email, Slack, webhook; custom `NotificationChannel`. No native mobile push found.
- Delegation: sub-agents (`agent-teams`, `agents/*.md`), A2A between apps, `sendToAgentChat()` from UI (no inline LLM calls).
- Realtime: `useDbSync` + `useChangeVersion`; SSE on long-lived hosts, polling on serverless.

## 8. Tooling, scaffolding, deployment

- CLI: `agent-native create | dev | build | start | action | typecheck | doctor | add-app | deploy | upgrade | eject`.
  Docs/source search are actions: `pnpm action docs-search | framework-search | source-search`.
- Scaffold: `npx @agent-native/core@latest create <name> --standalone --template <t>`; without `--standalone` it creates its own multi-app pnpm workspace (no Turborepo).
- Proven Turborepo setup: `../quantal` (pnpm + turbo, standalone agent-native app in `apps/agent`, root `pnpm-workspace.yaml` carrying `allowBuilds`/overrides the framework needs).
- Deploy targets via Nitro presets: Node, Docker, Vercel, Netlify, Cloudflare, AWS, Render… Both existing apps deploy to Netlify.

## 9. Files & vision

- Public uploads: `uploadFile()` → provider registry → S3-compatible built-in; never bytes in SQL.
- Private blobs: `@agent-native/core/private-blob` (`putPrivateBlob` → opaque handle). No built-in private provider — must register one (needed for food/body photos = PHI).
- Vision: chat attachments reach actions via `ctx.attachments`; actions can return images via `_agentImages`.
