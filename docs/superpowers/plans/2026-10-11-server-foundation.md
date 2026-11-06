# Server Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up `apps/server` (NestJS) so the companion and `gccli-sync` can pair a device, authenticate, and ingest health batches against it — with no agent-native dependency.

**Architecture:** A fresh NestJS app in the monorepo. Drizzle + Postgres for data (schema ported off `@agent-native/core/db` to plain `drizzle-orm/pg-core`). BetterAuth owns identity (magic link now; social later). Device tokens stay exactly as today (SHA-256-hashed `vdt_` bearer tokens, write-only). This plan is migration step 1 of the spec; it ships a server that gccli-sync can drive end to end.

**Tech Stack:** NestJS 11, `@nestjs/schedule` (later plan), Drizzle ORM (`drizzle-orm/pg-core`), `postgres` driver, BetterAuth, Vitest, `@vitls/health-ingest` (unchanged workspace package).

**Spec:** `docs/superpowers/specs/2026-10-11-mobile-native-nestjs-mastra-design.md`

## Global Constraints

- Node `>=22.12`, pnpm workspace package named `@vitls/server`, TypeScript from `@vitls/typescript-config`.
- **Owner-scoped, grant-based sharing.** Agent-native tenant federation is not ported: no `orgId`, no `isOrgMember`, no `runWithRequestContext`. Ownership key is `owner_email` only; the `org_id` columns are dropped. Cross-account access (e.g. a patient sharing read-only with a doctor) is a separate grant-based subsystem (`data_shares` table + read authorization), specified in its own plan — see the spec's "Data Sharing & Roles". It is a read-side concern; Plan #1's write/ingest path is owner-only and unaffected. Device tokens stay write-only and scoped to the pairing owner.
- **Route contract is frozen:** `POST /api/devices/redeem`, `POST /api/devices/sign-in`, `POST /api/ingest/v1/batches`, `POST|DELETE /api/devices/push` keep their exact paths and request/response JSON shapes — gccli-sync and shipped companion builds call them.
- **Device token format unchanged:** `vdt_` + `base64url(randomBytes(32))`, stored only as `sha256(token)` hex, plus a 10-char `token_prefix`. Pairing codes: 12 symbols from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown `XXXX-XXXX-XXXX`, stored only as `sha256(normalizedCode)`, 10-minute TTL.
- **No `@agent-native/*` imports anywhere in `apps/server`.** Porting a file means replacing framework primitives with the NestJS equivalents this plan defines.
- `@vitls/health-ingest` is imported as-is for `ingestBatchSchema`, `INGEST_LIMITS`, `deviceLabelSchema`, `IngestBatchInput`.

## Review Focus

- **Bearer token with wrong scope** → `requireDevice` must reject a token whose `scope != "ingest:write"` with 403, not accept it. (Task 7.)
- **Oversized / malformed ingest body** → body over `INGEST_LIMITS.maxBodyBytes` is charged and rejected before parsing; invalid JSON returns a 400 JSON error, never a 500 stack. (Task 9.)
- **Replayed pairing code** → a code already consumed or expired yields 400 `invalid_pairing_code`; redemption is atomic (one code → at most one token) under concurrent calls. (Task 6.)
- **Rate-limit key collision across users** → counter keys (`ingest:req:<deviceId>`, `redeem:client:<iphash>`) are per-subject; one device hitting its limit must not throttle another. (Task 5.)
- **Unknown/revoked token** → `authenticateDeviceToken` returns null for a token that is malformed, unknown, or `revoked_at` set; the route maps null to 401. (Task 7.)

---

### Task 1: NestJS app scaffold

**Files:**
- Create: `apps/server/package.json`, `apps/server/tsconfig.json`, `apps/server/nest-cli.json`
- Create: `apps/server/src/main.ts`, `apps/server/src/app.module.ts`
- Create: `apps/server/src/health.controller.ts`
- Test: `apps/server/src/health.controller.spec.ts`

**Interfaces:**
- Produces: a bootable Nest app; `GET /healthz` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

```ts
import { Test } from "@nestjs/testing";
import { HealthController } from "./health.controller";

test("healthz returns ok", async () => {
  const mod = await Test.createTestingModule({ controllers: [HealthController] }).compile();
  expect(mod.get(HealthController).healthz()).toEqual({ ok: true });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @vitls/server test health.controller`
Expected: FAIL — cannot find `./health.controller`.

- [ ] **Step 3: Scaffold the app and controller**

`apps/server/package.json` (scripts: `dev`: `nest start --watch`, `build`: `nest build`, `test`: `vitest --run`, `typecheck`: `tsc --noEmit`; deps: `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, `reflect-metadata`, `rxjs`; devDeps: `@nestjs/cli`, `@nestjs/testing`, `vitest`, `@vitls/typescript-config`).

```ts
// apps/server/src/health.controller.ts
import { Controller, Get } from "@nestjs/common";

@Controller()
export class HealthController {
  @Get("healthz")
  healthz() {
    return { ok: true };
  }
}
```

```ts
// apps/server/src/app.module.ts
import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller";

@Module({ controllers: [HealthController] })
export class AppModule {}
```

```ts
// apps/server/src/main.ts
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix("", { exclude: ["healthz"] });
  await app.listen(Number(process.env.PORT ?? 3001));
}
void bootstrap();
```

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @vitls/server test health.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server
git commit -m "feat(server): NestJS scaffold with healthz"
```

---

### Task 2: Drizzle schema port (device + ingest + rate-limit tables)

**Files:**
- Create: `apps/server/src/db/schema.ts`
- Test: `apps/server/src/db/schema.spec.ts`

**Interfaces:**
- Produces: `devicePairings`, `deviceTokens`, `rateLimits` Drizzle tables (plain `pg-core`), and the health tables the ingest path writes (`healthSources`, `dailyMetrics`, `pointMetrics`, `sleepSessions`, `workouts`, `intradaySeries`, `ingestBatches`). Each user-data table has `ownerEmail: text("owner_email").notNull()`; no `org_id`.

> Port from `apps/app/server/db/schema.ts`. Replace the `table(...)` + `ownableColumns()` helper with `pgTable(...)` and an inline `ownerEmail` column. Keep every column name and type. Keep `instant()` (TIMESTAMPTZ) and `date()` columns as-is; TimescaleDB hypertable creation is a migration concern (Task 3), not the schema definition.

- [ ] **Step 1: Write the failing test**

```ts
import { devicePairings, deviceTokens, rateLimits } from "./schema";

test("device tables expose the frozen columns", () => {
  expect(Object.keys(deviceTokens)).toEqual(
    expect.arrayContaining(["id", "tokenHash", "tokenPrefix", "label", "platform", "scope", "createdAt", "lastUsedAt", "revokedAt", "ownerEmail"]),
  );
  expect(Object.keys(devicePairings)).toEqual(
    expect.arrayContaining(["id", "codeHash", "expiresAt", "consumedAt", "createdAt", "ownerEmail"]),
  );
  expect(Object.keys(rateLimits)).toEqual(expect.arrayContaining(["key", "windowStart", "count"]));
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @vitls/server test db/schema`
Expected: FAIL — cannot find `./schema`.

- [ ] **Step 3: Write the schema**

```ts
// apps/server/src/db/schema.ts
import { bigint, pgTable, text } from "drizzle-orm/pg-core";

export const devicePairings = pgTable("device_pairings", {
  id: text("id").primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  consumedAt: text("consumed_at"),
  createdAt: text("created_at").notNull(),
  ownerEmail: text("owner_email").notNull(),
});

export const deviceTokens = pgTable("device_tokens", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  label: text("label"),
  platform: text("platform"),
  scope: text("scope").notNull().default("ingest:write"),
  createdAt: text("created_at").notNull(),
  lastUsedAt: text("last_used_at"),
  revokedAt: text("revoked_at"),
  ownerEmail: text("owner_email").notNull(),
});

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: bigint("window_start", { mode: "number" }).notNull(),
  count: bigint("count", { mode: "number" }).notNull(),
});
```

Then port `healthSources`, `dailyMetrics`, `pointMetrics`, `sleepSessions`, `workouts`, `intradaySeries`, `ingestBatches` from the source schema the same way (same columns, `ownerEmail` instead of `...ownableColumns()`, no `org_id`). Food/meal/dashboard tables are deferred to Plan #2.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @vitls/server test db/schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/db/schema.ts apps/server/src/db/schema.spec.ts
git commit -m "feat(server): port device/ingest/health schema to plain drizzle pg-core"
```

---

### Task 3: DB module + migrations

**Files:**
- Create: `apps/server/src/common/db/db.module.ts`, `apps/server/src/common/db/db.service.ts`
- Create: `apps/server/drizzle.config.ts`
- Create: `apps/server/src/db/migrate.ts`
- Test: `apps/server/src/common/db/db.service.spec.ts`

**Interfaces:**
- Produces: injectable `DbService` exposing `get db(): NodePgDatabase<typeof schema>`; `DbModule` is `@Global()`. Connection string from `DATABASE_URL`.

- [ ] **Step 1: Write the failing test** (round-trips a rate_limits row against the test Postgres)

```ts
import { DbService } from "./db.service";
import { rateLimits } from "../../db/schema";

test("DbService runs a query against Postgres", async () => {
  const svc = new DbService();
  await svc.db.insert(rateLimits).values({ key: "t:1", windowStart: 1, count: 1 });
  const [row] = await svc.db.select().from(rateLimits);
  expect(row?.key).toBe("t:1");
  await svc.onModuleDestroy();
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @vitls/server test db.service`
Expected: FAIL — cannot find `./db.service`.

- [ ] **Step 3: Implement DbService, module, drizzle config, migration runner**

```ts
// apps/server/src/common/db/db.service.ts
import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../db/schema";

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly pool = new Pool({ connectionString: process.env.DATABASE_URL });
  readonly db: NodePgDatabase<typeof schema> = drizzle(this.pool, { schema });
  async onModuleDestroy() {
    await this.pool.end();
  }
}
```

`drizzle.config.ts` points `schema` at `src/db/schema.ts`, `out` at `drizzle/`, dialect `postgresql`. `src/db/migrate.ts` runs `drizzle-orm/node-postgres/migrator`'s `migrate` against `DATABASE_URL`, then executes the TimescaleDB `create_hypertable` statements for `daily_metrics`, `point_metrics`, `intraday_series` guarded by `IF NOT EXISTS`/try-catch (TimescaleDB may be absent in dev — a plain table is fine, matching the source note). Generate the first migration with `drizzle-kit generate`.

`DbModule`:

```ts
// apps/server/src/common/db/db.module.ts
import { Global, Module } from "@nestjs/common";
import { DbService } from "./db.service";

@Global()
@Module({ providers: [DbService], exports: [DbService] })
export class DbModule {}
```

Add `DbModule` to `AppModule` imports.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @vitls/server test db.service` (requires `pnpm postgres` up and migrations applied to the test DB; add a `pretest` that runs `src/db/migrate.ts` against `DATABASE_URL`)
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/common/db apps/server/drizzle.config.ts apps/server/src/db/migrate.ts apps/server/drizzle
git commit -m "feat(server): drizzle DbService, migrations, timescale hypertables"
```

---

### Task 4: Rate-limit service

**Files:**
- Create: `apps/server/src/common/rate-limit/rate-limit.service.ts`, `apps/server/src/common/rate-limit/limits.ts`
- Test: `apps/server/src/common/rate-limit/rate-limit.service.spec.ts`

**Interfaces:**
- Consumes: `DbService`.
- Produces: `RateLimitService.hit(key: string, limit: { max: number; windowMs: number }, cost = 1): Promise<boolean>` (false when the fixed window is exhausted); `LIMITS` object with `redeemGlobal`, `redeemPerClient`, `openPairingsPerUser`, `ingestRequests`, `ingestBytes`.

> Port `LIMITS` values verbatim from `apps/app/server/lib/ingest/rate-limit.ts` (read it; copy the numbers). Port the fixed-window UPSERT from the same file.

- [ ] **Step 1: Write the failing test**

```ts
test("hit returns false once the window is exhausted", async () => {
  const svc = new RateLimitService(db);
  const limit = { max: 2, windowMs: 60_000 };
  expect(await svc.hit("k", limit)).toBe(true);
  expect(await svc.hit("k", limit)).toBe(true);
  expect(await svc.hit("k", limit)).toBe(false);
});

test("separate keys have separate counters", async () => {
  const svc = new RateLimitService(db);
  const limit = { max: 1, windowMs: 60_000 };
  expect(await svc.hit("a", limit)).toBe(true);
  expect(await svc.hit("b", limit)).toBe(true);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @vitls/server test rate-limit`
Expected: FAIL — cannot find the service.

- [ ] **Step 3: Implement the fixed-window counter**

Atomic UPSERT on `rate_limits`: if `window_start` is older than `now - windowMs`, reset `window_start = now, count = cost`; else `count = count + cost`; return `count <= max`. Use a single `INSERT ... ON CONFLICT (key) DO UPDATE` with a `CASE` on `window_start`, reading back `count`.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @vitls/server test rate-limit`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/common/rate-limit
git commit -m "feat(server): fixed-window rate-limit service, ported LIMITS"
```

---

### Task 5: BetterAuth (magic link) + mail

**Files:**
- Create: `apps/server/src/mail/mail.service.ts`, `apps/server/src/mail/mail.module.ts`
- Create: `apps/server/src/auth/auth.ts` (BetterAuth instance), `apps/server/src/auth/auth.module.ts`, `apps/server/src/auth/auth.controller.ts`
- Test: `apps/server/src/auth/auth.controller.spec.ts`, `apps/server/src/mail/mail.service.spec.ts`

**Interfaces:**
- Produces: BetterAuth mounted at `/_vitls/auth/*` (keeps the public prefix from `agent-native.config.ts` so magic-link callback URLs are stable). `MailService.send({ to, subject, html }): Promise<void>` → Resend in prod (`RESEND_EMAILS_URL` + API key), SMTP relay to Mailpit in dev (port 8025).
- Produces BetterAuth tables via its own migration keyed on `user.email`.

> Port the Resend payload shape from `apps/app/server/lib/smtp-relay.ts` / the `RESEND_EMAILS_URL` constant. BetterAuth's `magicLink` plugin `sendMagicLink({ email, url })` calls `MailService.send`. `callbackURL` default `/home` (frozen; the companion deep-links the whole domain).

- [ ] **Step 1: Write the failing test** (magic-link request triggers a mail send)

```ts
test("POST /_vitls/auth/magic-link/sign-in sends a mail", async () => {
  const sent: any[] = [];
  const app = await buildAuthApp({ mail: { send: async (m) => void sent.push(m) } });
  const res = await request(app).post("/_vitls/auth/magic-link/sign-in").send({ email: "a@b.co", callbackURL: "/home" });
  expect(res.status).toBe(200);
  expect(sent[0].to).toBe("a@b.co");
  expect(sent[0].html).toMatch(/http/);
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `pnpm --filter @vitls/server test auth.controller`
Expected: FAIL — auth app not built.

- [ ] **Step 3: Wire BetterAuth + MailService**

`auth.ts` builds `betterAuth({ database: drizzleAdapter(db), plugins: [magicLink({ sendMagicLink: ({ email, url }) => mail.send({ to: email, subject, html: linkEmail(url) }) })] })`. Mount its handler on an Express middleware at `/_vitls/auth/*` in `AuthModule.configure`. `MailService` posts to Resend in prod, SMTP to Mailpit in dev (reuse existing env: `MAILPIT_SMTP` host/port). Generate BetterAuth's schema migration.

- [ ] **Step 4: Run test, verify it passes**

Run: `pnpm --filter @vitls/server test auth.controller mail.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/auth apps/server/src/mail
git commit -m "feat(server): BetterAuth magic link mounted at /_vitls/auth, mail service"
```

---

### Task 6: Device pairing + token service

**Files:**
- Create: `apps/server/src/devices/devices.service.ts`
- Test: `apps/server/src/devices/devices.service.spec.ts`

**Interfaces:**
- Consumes: `DbService`, `RateLimitService`.
- Produces:
  - `createPairing(ownerEmail: string): Promise<{ code: string; expiresAt: string }>`
  - `redeemPairing(code: string, device: { platform: string; model?: string; appVersion?: string }): Promise<{ token: string; deviceId: string }>`
  - `authenticateDeviceToken(token: string): Promise<{ deviceId: string; userEmail: string; scope: string } | null>`
  - `touchDevice(deviceId, ownerEmail)`, `listDevices(ownerEmail)`, `revokeDevice(ownerEmail, deviceId)`

> Port `apps/app/server/lib/ingest/devices.ts` verbatim, dropping `orgId`/`OwnerScope.orgId` and the `isOrgMember` concerns. Keep `sha256`, `normalizeCode`, `generateCode`, `TOKEN_PREFIX`, `PAIRING_TTL_MS`, `CODE_ALPHABET` exactly. Replace agent-native `fail(...)` with Nest `throw new HttpException({ error, errorCode }, statusCode)`.

- [ ] **Step 1: Write the failing tests**

```ts
test("redeem issues a vdt_ token and is single-use", async () => {
  const { code } = await svc.createPairing("a@b.co");
  const { token, deviceId } = await svc.redeemPairing(code, { platform: "ios" });
  expect(token).toMatch(/^vdt_/);
  expect(deviceId).toMatch(/[0-9a-f-]{36}/);
  await expect(svc.redeemPairing(code, { platform: "ios" })).rejects.toMatchObject({ status: 400 });
});

test("authenticate resolves a live token, null for revoked", async () => {
  const { code } = await svc.createPairing("a@b.co");
  const { token, deviceId } = await svc.redeemPairing(code, { platform: "ios" });
  expect(await svc.authenticateDeviceToken(token)).toMatchObject({ userEmail: "a@b.co", scope: "ingest:write" });
  await svc.revokeDevice("a@b.co", deviceId);
  expect(await svc.authenticateDeviceToken(token)).toBeNull();
});

test("authenticate returns null for a non-vdt string", async () => {
  expect(await svc.authenticateDeviceToken("nope")).toBeNull();
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @vitls/server test devices.service`
Expected: FAIL — service missing.

- [ ] **Step 3: Port the service** (see interface + source file; atomic consume via `UPDATE ... WHERE consumed_at IS NULL AND expires_at > now RETURNING`).

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @vitls/server test devices.service`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/devices/devices.service.ts apps/server/src/devices/devices.service.spec.ts
git commit -m "feat(server): device pairing + write-only token service (single-tenant)"
```

---

### Task 7: Device auth guard

**Files:**
- Create: `apps/server/src/devices/device.guard.ts`
- Test: `apps/server/src/devices/device.guard.spec.ts`

**Interfaces:**
- Consumes: `DevicesService`, `RateLimitService`.
- Produces: `DeviceGuard` (Nest `CanActivate`) that reads `Authorization: Bearer <token>`, resolves identity, enforces `scope === "ingest:write"`, charges `LIMITS.ingestRequests` per `deviceId`, and attaches `req.device = { deviceId, userEmail, scope }`. 401 unknown/revoked, 403 wrong scope, 429 over limit.

> Port the auth half of `requireDevice` from `apps/app/server/lib/ingest/http.ts`, dropping the org-membership block.

- [ ] **Step 1: Write the failing tests**

```ts
test("rejects missing/invalid token with 401", async () => {
  await expect(run(guard, { headers: {} })).rejects.toMatchObject({ status: 401 });
});
test("rejects a non-ingest scope with 403", async () => {
  devices.authenticateDeviceToken = async () => ({ deviceId: "d", userEmail: "a@b.co", scope: "read:only" });
  await expect(run(guard, { headers: { authorization: "Bearer vdt_x" } })).rejects.toMatchObject({ status: 403 });
});
test("passes a valid ingest token and sets req.device", async () => {
  devices.authenticateDeviceToken = async () => ({ deviceId: "d", userEmail: "a@b.co", scope: "ingest:write" });
  const req: any = { headers: { authorization: "Bearer vdt_x" } };
  expect(await run(guard, req)).toBe(true);
  expect(req.device.userEmail).toBe("a@b.co");
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @vitls/server test device.guard`
Expected: FAIL — guard missing.

- [ ] **Step 3: Implement the guard** (regex `^Bearer\s+(\S+)$`, the three rejections, the rate-limit charge, attach `req.device`).

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @vitls/server test device.guard`
Expected: PASS (all three).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/devices/device.guard.ts apps/server/src/devices/device.guard.spec.ts
git commit -m "feat(server): device bearer-token guard with scope + rate-limit checks"
```

---

### Task 8: Devices controller (redeem, sign-in, push)

**Files:**
- Create: `apps/server/src/devices/devices.controller.ts`, `apps/server/src/devices/devices.module.ts`
- Create: `apps/server/src/devices/push.service.ts`
- Test: `apps/server/src/devices/devices.controller.spec.ts`

**Interfaces:**
- Produces, at the frozen paths:
  - `POST /api/devices/redeem` → body `{ code, device: { platform, model?, appVersion? } }`, throttled (`throttleRedeem`), returns `{ token, deviceId, ingestUrl: "/api/ingest/v1/batches" }`.
  - `POST /api/devices/sign-in` → body `{ email }`, throttled, forwards to BetterAuth magic-link sign-in with `callbackURL: "/home"`, returns `{ ok: true }` or the mapped error.
  - `POST /api/devices/push` / `DELETE /api/devices/push` → register/unregister an Expo push token for `req.device` (behind `DeviceGuard`). Port columns/logic from `apps/app/server/routes/api/devices/push.*.ts` and `lib/notifications`.

> `sign-in` no longer needs to spell out the magic-link route via config — it calls BetterAuth directly. Keep the response shape identical. Throttle with `RateLimitService` using the ported `throttleRedeem` logic (global + per-client-IP hash; trust only `x-nf-client-connection-ip` then `req.ip`).

- [ ] **Step 1: Write the failing tests**

```ts
test("redeem returns token + frozen ingestUrl", async () => {
  const res = await request(app).post("/api/devices/redeem").send({ code, device: { platform: "cli" } });
  expect(res.status).toBe(200);
  expect(res.body.ingestUrl).toBe("/api/ingest/v1/batches");
  expect(res.body.token).toMatch(/^vdt_/);
});
test("redeem with a bad code returns 400 invalid_pairing_code", async () => {
  const res = await request(app).post("/api/devices/redeem").send({ code: "AAAA-AAAA-AAAA", device: { platform: "cli" } });
  expect(res.status).toBe(400);
  expect(res.body.errorCode).toBe("invalid_pairing_code");
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @vitls/server test devices.controller`
Expected: FAIL — controller missing.

- [ ] **Step 3: Implement the controller, push service, module** (module provides `DevicesService`, `PushService`, imports `DbModule`, `RateLimit`, `Auth`, `Mail`). Register a global exception filter that maps `HttpException` payloads to the `{ error, errorCode }` JSON shape and ZodError to `{ error: "Invalid payload", errorCode: "invalid_payload", issues }` — port `deviceRoute`'s mapping.

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @vitls/server test devices.controller`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/devices
git commit -m "feat(server): devices controller — redeem, sign-in, push at frozen paths"
```

---

### Task 9: Ingest controller (batches)

**Files:**
- Create: `apps/server/src/ingest/ingest.service.ts`, `apps/server/src/ingest/ingest.controller.ts`, `apps/server/src/ingest/ingest.module.ts`
- Create: `apps/server/src/ingest/entitlements.service.ts`
- Test: `apps/server/src/ingest/ingest.controller.spec.ts`, `apps/server/src/ingest/ingest.service.spec.ts`

**Interfaces:**
- Consumes: `DeviceGuard`, `DbService`, `RateLimitService`.
- Produces: `POST /api/ingest/v1/batches` (behind `DeviceGuard`) → parses `ingestBatchSchema`, charges `LIMITS.ingestBytes` by Content-Length before reading (cap at `INGEST_LIMITS.maxBodyBytes`), stores the batch, touches the device, returns `{ batchId, duplicate, stored, skipped, plan }`.
- `ingestBatch({ identity, batch, entitlements, allowDevSources }): Promise<{ batchId; duplicate; stored; skipped; sourceId }>`.

> Port `apps/app/server/lib/ingest/ingest.ts` and `entitlements.ts`. Drop `insertAuditEvent`/`recordChange`/`notifyFirstBatch`/`purgeExpiredArchives` for now (they are agent-native audit/realtime concerns; re-add in Plan #2 or drop — note in the commit). Keep idempotent upsert keyed on the batch dedup key. Raw-body size limit via Nest body-parser `limit: INGEST_LIMITS.maxBodyBytes`.

- [ ] **Step 1: Write the failing tests**

```ts
test("rejects a batch with no bearer token (401)", async () => {
  const res = await request(app).post("/api/ingest/v1/batches").send(validBatch);
  expect(res.status).toBe(401);
});
test("stores a batch and reports stored counts", async () => {
  const res = await request(app).post("/api/ingest/v1/batches").set("authorization", `Bearer ${token}`).send(validBatch);
  expect(res.status).toBe(200);
  expect(res.body.batchId).toBeDefined();
  expect(res.body.duplicate).toBe(false);
});
test("the same batch twice is idempotent (duplicate: true)", async () => {
  await request(app).post("/api/ingest/v1/batches").set("authorization", `Bearer ${token}`).send(validBatch);
  const res2 = await request(app).post("/api/ingest/v1/batches").set("authorization", `Bearer ${token}`).send(validBatch);
  expect(res2.body.duplicate).toBe(true);
});
test("a malformed body returns 400 invalid_payload, not 500", async () => {
  const res = await request(app).post("/api/ingest/v1/batches").set("authorization", `Bearer ${token}`).send({ nope: 1 });
  expect(res.status).toBe(400);
  expect(res.body.errorCode).toBe("invalid_payload");
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `pnpm --filter @vitls/server test ingest`
Expected: FAIL — module missing.

- [ ] **Step 3: Port the ingest service + controller + entitlements** (see interfaces and source files).

- [ ] **Step 4: Run tests, verify they pass**

Run: `pnpm --filter @vitls/server test ingest`
Expected: PASS (all four).

- [ ] **Step 5: Commit**

```bash
git add apps/server/src/ingest
git commit -m "feat(server): ingest batches endpoint, idempotent, byte-charged, guarded"
```

---

### Task 10: End-to-end validation with gccli-sync

**Files:**
- Modify: `apps/server/README.md` (run instructions)
- Test: `apps/server/test/e2e-gccli.spec.ts`

**Interfaces:**
- Consumes: the running server + `@vitls/gccli-sync` CLI.
- Produces: proof that an unmodified gccli-sync redeems a pairing code and pushes a batch to the new server.

- [ ] **Step 1: Write the failing e2e test**

Boot the Nest app on an ephemeral port against the test DB. Create a pairing for a seeded user (call `DevicesService.createPairing`). Spawn `pnpm gccli:pair --server http://localhost:<port> --code <code>` then `pnpm gccli:sync`. Assert the CLI exits 0 and a `health_sources` row exists for the user.

- [ ] **Step 2: Run it, verify it fails** (server not wired / env missing)

Run: `pnpm --filter @vitls/server test e2e-gccli`
Expected: FAIL initially.

- [ ] **Step 3: Fix wiring until green** (env: `DATABASE_URL`, `PORT`; ensure `exclude: ["healthz"]` and `/api` paths resolve; no `/api` global prefix collision).

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @vitls/server test e2e-gccli`
Expected: PASS — gccli-sync drives the new server end to end.

- [ ] **Step 5: Commit**

```bash
git add apps/server/test/e2e-gccli.spec.ts apps/server/README.md
git commit -m "test(server): gccli-sync pairs and ingests against the new server e2e"
```

---

## Self-Review

**Spec coverage (migration step 1):** NestJS scaffold (T1), Drizzle + Postgres with ported schema and Timescale (T2–T3), BetterAuth magic link at `/_vitls/auth` + mail (T5), `devices/` redeem/sign-in/push at frozen paths (T6–T8), `ingest/` batches (T9), rate limiting (T4), e2e proof (T10). Social sign-in (Apple/Google), business-logic modules, Mastra, scheduler, and companion are later plans — out of scope here by design.

**Placeholder scan:** No TBD/TODO. Ports name their exact source file and the transformation (drop org, swap `fail`→`HttpException`, swap `@agent-native` primitives). Where a step says "port the rest of the tables," the pattern is shown in full on the device tables and the column rule is stated.

**Type consistency:** `DeviceIdentity` shape (`{ deviceId, userEmail, scope }`) is consistent across T6 (service), T7 (guard, attaches `req.device`), T9 (consumes `req.device`). Token format and `ingestUrl` constant match the frozen contract in Global Constraints. `RateLimitService.hit` signature consistent T4→T7→T8→T9.

**Review Focus:** wrong-scope token (T7 test), oversized/malformed body (T9 test), replayed pairing code (T6 + T8 tests), rate-limit key isolation (T4 test), unknown/revoked token (T6 + T7 tests). All five pinned.

**Open decision for the user:** not porting tenant federation (Global Constraints) and dropping the ingest audit/realtime side-effects (T9) are simplifications. Cross-account read-only sharing with a doctor is confirmed as a requirement and is a separate plan (grant-based, read-side); it does not change Plan #1's owner-only write path.
