# Reuse shortlist from `../quantal` and `../getmedoc2` (APPROVED 2026-10-01)

> Copied into `.claude/skills/` so far: agent-native-first, reducing-entropy, security-audit, commit (scopes adapted),
> github-communication, gh-issue-fetch, skill-creator. `agent-data-tools` and `vibe-loop` are tightly bound to quantal's
> architecture (NATS recorder, `apps/agent` scripts) and will be rewritten for VITLS when the first data feature / dev loop lands.

## Governing skill

- `agent-native-first` — located at `../quantal/.claude/skills/agent-native-first/SKILL.md`
  (identical copy in `../getmedoc2/.agents/skills/`; the build prompt's path `../quantal/apps/agent` is inaccurate).
  Mandatory gate for every source change: study version-matched docs/corpus → plan under `reducing-entropy`
  → report the study block → implement → `agent-native doctor` + `typecheck`.

## Framework-stock skills (installed by agent-native; no copying needed)

actions, adding-a-feature, agent-engines, agent-native-docs, agent-native-toolkit, app-branding, app-permissions,
context-awareness, customizing-agent-native, delegate-to-agent, external-agents, frontend-design, inline-embeds,
notifications, portability, progress, real-time-sync, secrets, security, self-modifying-code, shadcn-ui, sharing,
storing-data, turn-into-app, turn-into-skill, workspace-conventions, visual-plan.

## Custom skills — proposed to reuse

| Skill | From | Why for VITLS | Action |
|---|---|---|---|
| agent-native-first | quantal | Mandatory doctrine | Copy as-is |
| reducing-entropy | quantal | Required by agent-native-first | Copy as-is |
| agent-data-tools | quantal | Read-only data action + `outputSchema` + `chatUI.renderer` + one widget used in chat and dashboard; LISTEN/NOTIFY live refresh; result-size caps | Copy, adapt wording to health metrics |
| adding-a-recorder-adapter | quantal | Single-writer ingest, per-source adapters, natural keys, upsert modes, golden fixtures | Adapt → `adding-a-wearable-provider` |
| quantal-data-feeds (in-app) | quantal | Pattern for an in-app agent skill: registry of data sources, which action answers what, empty-state reasons | Adapt → `vitls-health-metrics` |
| vibe-loop (+ `scripts/vibe-*.mjs`) | quantal | Autonomous dev loop with status beacon | Copy |
| service-tasks | quantal | Uniform `pnpm <svc>` / `:debug` tasks if a sync worker is added | Defer until a worker exists |
| security-audit | both | PHI-grade vulnerability review | Copy |
| commit, github-communication, gh-issue-fetch | both | Repo hygiene | Copy |
| skill-creator | both | Authoring VITLS skills | Copy |
| stripe | getmedoc2 | Catalog-as-code billing | Defer until pricing is decided |
| infra | both | Local docker/ports rules | Rewrite for VITLS ports |

**Skip (stale/irrelevant):** getmedoc2 `permissions`, `agent-tools`, `telegram`, `sim` (concept is valuable — persona simulator for coach regression tests — but the code no longer exists), `postgres`; quantal `golang`, `research-workflow`.

## Code patterns — proposed to reuse

- **Dashboard config + storage:** `../quantal/apps/agent/shared/dashboard.ts`, `server/db/index.ts` (`createDashboardStorage`), `docs/design/live-dashboard.md`.
- **Widget result helpers:** `../quantal/apps/agent/server/lib/widget.ts`, `app/components/feeds/DataWidget.tsx`.
- **Live refresh:** `../quantal/apps/agent/server/plugins/feeds-listener.ts` (coalesced change notifications).
- **Org scoping helper:** `../getmedoc2/server/db/index.ts` `requireOrg(ctx)`; `agent-native.json → doctor.dbToolScopingDenylist` with dated reasons.
- **Tool-surface containment:** `../getmedoc2/server/plugins/agent-chat.ts` `resolveActionSurface` + disabled framework tools.
- **AI containment doctrine:** `../getmedoc2/docs/product/ai-containment.md` (enforced by which tools exist, not by prompting) → VITLS "coach, not doctor" boundary.
- **Compliance baseline:** `../getmedoc2/docs/business/compliance.md` (GDPR Art. 9, consent as audit event, erasure by anonymisation).
- **Production migrations:** `scripts/migrate-production.ts` + `netlify.toml` release step.
- **Provider abstraction:** quantal Go `SyncFunc(ctx, cursor) → { items, syncedTo }` with supervised loop and persisted cursor; getmedoc `ingestProviders` + `provider_external_refs(source, external_id, raw_snapshot_json)`; outreach `ChannelPort` with stub/simulate/live modes that fail closed.
- **Workspace config:** `../quantal/pnpm-workspace.yaml` (`allowBuilds`, overrides, `minimumReleaseAgeExclude` for `@agent-native/*`), `turbo.json`.
- **Local email:** `dev-smtp-relay.ts` → Mailpit.

## Hard-won lessons to carry over

- Widgets render after reply text — prompts must never say "above".
- Cap tool results (~45k chars) — oversized JSON gets truncated into invalid JSON.
- `.gitignore` `**/data/` silently drops `app/components/data/`.
- Don't navigate mid-run (unmounts the stream); write app state, navigate after the turn.
- DB, not the conversation, is the source of truth — re-read state at the start of each turn.
- Accept all webhook event types or providers redeliver forever.
- Replace template analytics IDs (`GA_MEASUREMENT_ID`, `GTM_CONTAINER_ID`) in `netlify.toml`.
